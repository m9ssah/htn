import { WebSocketServer, type WebSocket } from 'ws';
import { createTurnRunner, type Turn, type TurnDeps } from './harness/turn.js';
import { parseClientMessage, WIRE_PROTOCOL_VERSION, type ServerMessage } from './wire.js';

/**
 * The device transport: a websocket in front of the turn runner.
 *
 * This is the real implementation of the seam `createRealPatchSinkStore`
 * was designed around, and it is deliberately thin — a `for await` over
 * `turn.patches` that calls `ws.send`. Everything that makes the stream
 * correct (turn gating, the abort signal, the buffered log, not losing
 * patches when a node crashes) already lives in `turn.ts` and is tested
 * there. If this file grew logic about *what* an update means, the layering
 * would be wrong.
 *
 * One device. `CLAUDE.md` describes a Raspberry Pi with a 4" screen, not a
 * fleet, and a second connection is refused rather than fanned out: two
 * devices sharing one session would race for the same task state, and the
 * failure would show up as a confusing surface rather than as an error.
 */

export type SurfaceServerOptions = {
  /** Everything `startTurn` needs. The graph is injected, so this file never imports one. */
  deps: TurnDeps;
  /** 0 picks a free port — what tests use. */
  port?: number;
  host?: string;
  /** Structured log line. Defaults to stderr so stdout stays clean for piping. */
  log?: (event: string, data?: Record<string, unknown>) => void;
};

export type SurfaceServer = {
  readonly port: number;
  readonly url: string;
  /** How many devices are connected right now. 0 or 1. */
  readonly connections: number;
  close(): Promise<void>;
};

const defaultLog = (event: string, data?: Record<string, unknown>): void => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
};

export async function createSurfaceServer(options: SurfaceServerOptions): Promise<SurfaceServer> {
  const log = options.log ?? defaultLog;
  const host = options.host ?? '127.0.0.1';
  const wss = new WebSocketServer({ port: options.port ?? 0, host });

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  let connections = 0;

  wss.on('connection', (ws: WebSocket) => {
    if (connections > 0) {
      // 1013 "Try Again Later" — the honest code for "not now", rather than
      // pretending a fanout server that does not exist is merely busy.
      log('connection-refused', { reason: 'device already connected' });
      ws.close(1013, 'device already connected');
      return;
    }
    connections += 1;
    log('device-connected', {});
    attachDevice(ws, options.deps, log, () => {
      connections -= 1;
    });
  });

  // A server-level `error` with no listener is an unhandled 'error' event,
  // which takes the process down. The demo must not die because a socket did.
  wss.on('error', (err) => log('server-error', { error: String(err) }));

  const address = wss.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

  return {
    port,
    url: `ws://${host}:${port}`,
    get connections(): number {
      return connections;
    },
    close(): Promise<void> {
      // `close()` is callback-async: returning before it fires leaves an
      // open handle, which a test runner reports as a timeout rather than as
      // a leak.
      return new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      });
    },
  };
}

function attachDevice(
  ws: WebSocket,
  deps: TurnDeps,
  log: (event: string, data?: Record<string, unknown>) => void,
  onGone: () => void,
): void {
  const runner = createTurnRunner(deps);
  let activeTurnId: string | null = null;
  let closed = false;

  /**
   * Fire and forget. `ws.send` is non-blocking and takes no callback here on
   * purpose: p19c measured that lag between receiving a chunk and handling
   * it is what loses queued writes, and awaiting a send ack is exactly that
   * lag. A frame that cannot go out is reported, not retried.
   *
   * The `readyState` check is a cost-saver, not a correctness guard, and is
   * measured as one: with it removed every test still passes, because
   * `ws.send` on a closed socket in `ws` 8.x does not throw — it emits
   * `error`, which `teardown` already handles. What it buys is not doing a
   * `JSON.stringify` of a surface update into a socket that is gone, and not
   * turning every such frame into a spurious `socket-error` log line.
   */
  const send = (message: ServerMessage): boolean => {
    if (closed || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  };

  // First frame on the connection, so a device fails loudly on a version
  // skew instead of silently misreading frames.
  send({ type: 'hello', protocol: WIRE_PROTOCOL_VERSION });

  const pump = async (turn: Turn): Promise<void> => {
    let seq = 0;
    let outcome: 'ok' | 'aborted' | 'crashed' = 'ok';
    send({ type: 'turn-start', turnId: turn.turnId });
    try {
      for await (const update of turn.patches) {
        // A redundant backstop, and labelled as one so nobody reads it as
        // the mechanism. What actually stops an interrupted turn reaching
        // the device is the sink's signal gate in `clients/sink.ts` —
        // measured: with that gate alone active and this check, `turn.ts`'s
        // queue drain and `sink.close()` all disabled, the barge-in test
        // over a real socket still passes; with the signal gate ALSO off,
        // 11 frames from the interrupted turn reach the device.
        //
        // It stays because it is free and covers the disconnect case
        // (`closed`) without a wasted `JSON.stringify` into a dead socket.
        if (closed || turn.turnId !== activeTurnId) {
          turn.log.record('update-undelivered', { reason: closed ? 'disconnected' : 'superseded', seq });
          outcome = 'aborted';
          break;
        }
        if (!send({ type: 'update', turnId: turn.turnId, seq, update })) {
          // The socket went away between the readyState check and now. The
          // patch is already past the sink, so this is the one place it can
          // be reported.
          turn.log.record('update-undelivered', { reason: 'disconnected', seq });
          outcome = 'aborted';
          break;
        }
        seq += 1;
      }
    } catch (err) {
      // A bug in the turn runner must not take the socket — or the process —
      // with it. The device keeps the surface it has.
      outcome = 'crashed';
      log('turn-pump-error', { turnId: turn.turnId, error: String(err) });
    } finally {
      if (outcome === 'ok' && turn.log.entries.some((e) => e.kind === 'abort')) outcome = 'aborted';
      send({ type: 'turn-end', turnId: turn.turnId, outcome, updates: seq });
      if (activeTurnId === turn.turnId) activeTurnId = null;
      log('turn-end', { turnId: turn.turnId, outcome, updates: seq });
    }
  };

  ws.on('message', (data: unknown) => {
    const parsed = parseClientMessage(String(data));
    if (!parsed.ok) {
      // Never close on a bad frame: a device disconnected for one malformed
      // message reconnects and sends it again, which is a loop.
      log('bad-frame', { reason: parsed.reason });
      send({ type: 'error', reason: parsed.reason });
      return;
    }

    if (parsed.message.type === 'action') {
      // Reserved. Control events bypass the graph by design (plan: "a slider
      // scrub emits a cached content patch"), and there is nothing to serve
      // from until the concrete graph exists. Acknowledged so the device
      // workstream sees a defined response rather than silence.
      log('action-unhandled', { action: parsed.message.action, elementId: parsed.message.elementId });
      send({ type: 'error', reason: `action "${parsed.message.action}" is not handled yet` });
      return;
    }

    // `say` aborts whatever turn is in flight — barge-in is the normal way
    // to correct yourself on a voice device, not an exception.
    const turn = runner.say({ utterance: parsed.message.text });
    activeTurnId = turn.turnId;
    log('turn-start', { turnId: turn.turnId });
    void pump(turn);
  });

  const teardown = (why: string): void => {
    if (closed) return;
    closed = true;
    // A turn in flight when the socket drops must abort rather than keep
    // paying a model to render into a dead socket.
    runner.abort(new Error(`socket ${why}`));
    activeTurnId = null;
    onGone();
    log('device-disconnected', { why });
  };

  ws.on('close', () => teardown('closed'));
  // Without this listener an `error` event on a `ws` socket is an unhandled
  // 'error' and throws out of the event loop. `close` alone does not cover it.
  ws.on('error', (err) => {
    log('socket-error', { error: String(err) });
    teardown('errored');
  });
}
