import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSurfaceServer, type SurfaceServer } from '../src/ws-server.js';
import type { ServerMessage } from '../src/wire.js';
import { deps, emitThenThrow, emitter, oneNodeGraph, signalIgnoringEmitter, sleep } from './harness/doubles.js';
import type { PatchStream } from '../src/harness/turn.js';

/**
 * The websocket transport, end to end over a real loopback socket.
 *
 * Binds `127.0.0.1:0` and tears down in `afterEach` — `npm test` must leave
 * no listener behind. `ws`'s `close()` is callback-async, so a test that
 * returns before it fires leaves an open handle, which vitest reports as a
 * timeout rather than as a leak.
 *
 * The `ws` package's `WebSocket`, not Node's global: the global exists on
 * Node 26 but differs on close codes, and this suite asserts one.
 */

let server: SurfaceServer | null = null;
const sockets: WebSocket[] = [];
const dir = join(tmpdir(), `jit-ws-${process.pid}`);

afterEach(async () => {
  // Server FIRST, clients second, and `terminate()` rather than `close()`.
  // `close()` on a client whose server socket is already destroyed waits out
  // the close handshake — ~30s in `ws` — which surfaces as a vitest timeout
  // rather than as the leak it is.
  await server?.close();
  for (const s of sockets.splice(0)) s.terminate();
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

async function boot(graph: PatchStream): Promise<SurfaceServer> {
  server = await createSurfaceServer({ deps: deps(graph), log: () => {} });
  return server;
}

/** Connects and collects every frame, resolving each `waitFor` as it arrives. */
function connect(url: string): {
  socket: WebSocket;
  frames: ServerMessage[];
  open: Promise<void>;
  waitFor(predicate: (f: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  closed: Promise<{ code: number; reason: string }>;
} {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const frames: ServerMessage[] = [];
  const listeners: { predicate: (f: ServerMessage) => boolean; resolve: (f: ServerMessage) => void }[] = [];

  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as ServerMessage;
    frames.push(frame);
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      const listener = listeners[i];
      if (listener && listener.predicate(frame)) {
        listeners.splice(i, 1);
        listener.resolve(frame);
      }
    }
  });

  return {
    socket,
    frames,
    open: new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    closed: new Promise((resolve) => socket.once('close', (code, reason) => resolve({ code, reason: String(reason) }))),
    waitFor(predicate, timeoutMs = 3000): Promise<ServerMessage> {
      const already = frames.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), timeoutMs);
        listeners.push({
          predicate,
          resolve: (f) => {
            clearTimeout(timer);
            resolve(f);
          },
        });
      });
    },
  };
}

const updates = (frames: ServerMessage[]): Extract<ServerMessage, { type: 'update' }>[] =>
  frames.filter((f): f is Extract<ServerMessage, { type: 'update' }> => f.type === 'update');

describe('ws server: a turn over the wire', () => {
  it('greets with the protocol version before anything else', async () => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const client = connect(s.url);
    await client.open;
    const hello = await client.waitFor((f) => f.type === 'hello');
    expect(hello).toEqual({ type: 'hello', protocol: 1 });
    expect(client.frames[0]?.type).toBe('hello');
  });

  it('an utterance produces turn-start, numbered updates, and turn-end ok', async () => {
    const s = await boot(oneNodeGraph(emitter(3)));
    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'what should I make tonight' }));

    const end = (await client.waitFor((f) => f.type === 'turn-end')) as Extract<ServerMessage, { type: 'turn-end' }>;
    const sent = updates(client.frames);

    expect(client.frames.map((f) => f.type)).toEqual(['hello', 'turn-start', 'update', 'update', 'update', 'turn-end']);
    expect(end.outcome).toBe('ok');
    expect(end.updates).toBe(3);
    // `seq` is per-turn and monotonic from 0 — the one thing that lets the
    // device tell "nothing was produced" from "something was lost".
    expect(sent.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(new Set(sent.map((f) => f.turnId))).toEqual(new Set([end.turnId]));
  });

  it('passes the update through untouched — no stage normalisation, no rewrapping', async () => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'hi' }));
    await client.waitFor((f) => f.type === 'turn-end');

    // Byte-identical to what `doubles.patch(1)` emitted. The renderer
    // discriminates style/polish on `'theme' in`/`'tokens' in`, so a
    // transport that stamped `stage` onto everything would be inventing
    // contract.
    expect(updates(client.frames)[0]?.update).toEqual({
      v: 2,
      stage: 'content',
      requestId: 'test-request',
      generationId: 'test-generation',
      complete: false,
      values: { probe: { n: 1 } },
    });
  });

  it('a node crash mid-turn still delivers everything emitted before it, and the socket survives', async () => {
    const s = await boot(oneNodeGraph(emitThenThrow(5, 0)));
    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'crash please' }));

    const end = (await client.waitFor((f) => f.type === 'turn-end')) as Extract<ServerMessage, { type: 'turn-end' }>;
    expect(updates(client.frames)).toHaveLength(5);
    expect(end.outcome).toBe('ok'); // the node's fault is logged, not a turn failure
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    // And the connection is still usable afterwards.
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'again' }));
    const second = await client.waitFor((f) => f.type === 'turn-end' && f.turnId !== end.turnId);
    expect(second.type).toBe('turn-end');
  });
});

describe('ws server: barge-in', () => {
  it('a second utterance aborts the first turn and no later frame carries its turnId', async () => {
    const attempts: number[] = [];
    const s = await boot(oneNodeGraph(signalIgnoringEmitter(12, 15, attempts)));
    const client = connect(s.url);
    await client.open;

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'first' }));
    const first = (await client.waitFor((f) => f.type === 'turn-start')) as Extract<ServerMessage, { type: 'turn-start' }>;
    await client.waitFor((f) => f.type === 'update');

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'actually, second' }));
    const secondStart = (await client.waitFor(
      (f) => f.type === 'turn-start' && f.turnId !== first.turnId,
    )) as Extract<ServerMessage, { type: 'turn-start' }>;

    await client.waitFor((f) => f.type === 'turn-end' && f.turnId === secondStart.turnId, 5000);
    await sleep(250); // let the leaked first node run well past its abort

    // The node kept going — that is the p19b finding and the point of the
    // test: the guarantee cannot come from the node.
    expect(attempts.length).toBeGreaterThan(4);

    /*
     * The property, asserted by COUNT and not by position.
     *
     * An earlier version of this test sliced the frame list after the first
     * turn's `turn-end` and asserted nothing followed. That passes
     * vacuously when barge-in is broken: a first turn that keeps streaming
     * simply ends LAST, and the slice after it is empty. Verified by
     * disabling all three abort guards — the old assertion stayed green.
     *
     * What actually distinguishes them is how many of the interrupted
     * turn's updates land once the replacement turn has started.
     */
    const secondStartIndex = client.frames.indexOf(secondStart);
    const leaked = client.frames
      .slice(secondStartIndex)
      .filter((f) => f.type === 'update' && f.turnId === first.turnId);
    expect(leaked).toHaveLength(0);

    // And the interrupted turn delivered far fewer updates than the node produced.
    const firstUpdates = updates(client.frames).filter((f) => f.turnId === first.turnId);
    expect(firstUpdates.length).toBeLessThan(attempts.length);

    const firstEnd = client.frames.find((f) => f.type === 'turn-end' && f.turnId === first.turnId) as
      | Extract<ServerMessage, { type: 'turn-end' }>
      | undefined;
    expect(firstEnd?.outcome).toBe('aborted');
  });
});

describe('ws server: disconnect', () => {
  /**
   * Two separate claims, and the first one needs the turn log to check.
   *
   * An earlier version asserted only "the server is still up and a new
   * device can connect". That passes with the disconnect's `runner.abort()`
   * deleted — the leaked node just runs to completion, `send` returns false
   * on `readyState`, and the second device connects fine. Verified: with the
   * abort commented out, that version stayed green.
   *
   * "Stopped paying for a dead turn" is a different claim from "survived",
   * and only the turn log can distinguish them.
   */
  it('a disconnect mid-turn aborts the turn in flight, and the server survives', async () => {
    const logPath = join(dir, 'disconnect.jsonl');
    const attempts: number[] = [];
    server = await createSurfaceServer({
      deps: deps(oneNodeGraph(signalIgnoringEmitter(12, 15, attempts)), { logPath }),
      log: () => {},
    });
    const s = server;

    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'start something long' }));
    await client.waitFor((f) => f.type === 'update');

    client.socket.close();
    await client.closed;
    await sleep(250);

    // The node was still running when the socket dropped...
    expect(attempts.length).toBeGreaterThan(2);
    // ...and the turn was aborted rather than left to render into a dead socket.
    const record = JSON.parse(readFileSync(logPath, 'utf8').trim().split('\n')[0] as string) as {
      outcome: string;
      entries: { kind: string; reason?: string }[];
    };
    const abort = record.entries.find((e) => e.kind === 'abort');
    expect(abort?.reason).toContain('socket closed');
    expect(record.outcome).toBe('aborted');

    // And the server is still up: a new device can connect and drive a turn.
    expect(s.connections).toBe(0);
    const second = connect(s.url);
    await second.open;
    second.socket.send(JSON.stringify({ type: 'utterance', text: 'after the drop' }));
    const end = await second.waitFor((f) => f.type === 'turn-end');
    expect(end.type).toBe('turn-end');
  });

  it('refuses a second device rather than fanning out', async () => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const first = connect(s.url);
    await first.open;
    await first.waitFor((f) => f.type === 'hello');

    const second = connect(s.url);
    const { code, reason } = await second.closed;
    expect(code).toBe(1013);
    expect(reason).toContain('already connected');
    expect(s.connections).toBe(1);
  });
});

describe('ws server: untrusted input', () => {
  it.each([
    ['not json at all', 'not valid JSON'],
    ['[1,2,3]', 'not a JSON object'],
    ['{"type":"nope"}', 'unknown message type'],
    ['{"type":"utterance"}', 'must be a string'],
    ['{"type":"utterance","text":"   "}', 'is empty'],
  ])('answers %j with an error frame and keeps the connection', async (frame, expected) => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const client = connect(s.url);
    await client.open;
    await client.waitFor((f) => f.type === 'hello');

    client.socket.send(frame);
    const error = (await client.waitFor((f) => f.type === 'error')) as Extract<ServerMessage, { type: 'error' }>;
    expect(error.reason).toContain(expected);
    // A device disconnected for one malformed message reconnects and sends
    // it again — that is a loop, not a recovery.
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'still works' }));
    expect((await client.waitFor((f) => f.type === 'turn-end')).type).toBe('turn-end');
  });

  it('refuses an over-long utterance without closing', async () => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'x'.repeat(2001) }));
    const error = (await client.waitFor((f) => f.type === 'error')) as Extract<ServerMessage, { type: 'error' }>;
    expect(error.reason).toContain('exceeds 2000');
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  /**
   * A control event used to be acknowledged as "not handled yet". It now runs
   * a turn, through the same runner and the same framing as an utterance —
   * which is what makes a press barge in on speech. What this asserts is the
   * TRANSPORT half: the action reaches a turn and is framed as one. What the
   * graph does with it is `graph.test.ts`'s job.
   */
  it('runs a control event as a turn rather than refusing it', async () => {
    const s = await boot(oneNodeGraph(emitter(1)));
    const client = connect(s.url);
    await client.open;
    client.socket.send(JSON.stringify({ type: 'action', action: 'begin', elementId: 'start', value: 30 }));
    const end = (await client.waitFor((f) => f.type === 'turn-end')) as Extract<ServerMessage, { type: 'turn-end' }>;
    expect(end.updates).toBe(1);
    expect(client.frames.some((f) => f.type === 'error')).toBe(false);
  });
});
