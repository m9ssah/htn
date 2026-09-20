import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ContentUpdateSchema, StructureUpdateSchema } from '@jit/schema';
import { buildGraph } from '../src/graph.js';
import { createSession } from '../src/session.js';
import { createReplayJevClient } from '../src/harness/clients/jev.js';
import { stubContentSource } from '../src/harness/clients/content.js';
import { createSurfaceServer, type SurfaceServer } from '../src/ws-server.js';
import type { ServerMessage } from '../src/wire.js';
import type { JevClient } from '../src/harness/types.js';
import { sleep } from '../src/harness/signal.js';

/**
 * The REAL graph over a REAL websocket.
 *
 * Every existing websocket test drives a synthetic graph emitting a
 * hand-built `ContentUpdateV2` probe, so until now no actual composed surface
 * had ever crossed the wire — the transport was proven and the payload was
 * not. These two tests close that: the frames are parsed with the schemas the
 * device parses them with, and the barge-in case uses a `decide` slow enough
 * for the second utterance to land inside the first turn.
 *
 * Offline: a replay Jev fixture, the stub content source, `127.0.0.1:0`, and
 * a teardown that leaves no listener behind.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
/** `new_task` -> `choice_cards`: projected, so the whole surface is deterministic. */
const NEW_TASK = join(FIXTURES, 'jev/recorded/new_task.json');

let server: SurfaceServer | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  // Server first, clients second, `terminate()` not `close()` — a client
  // whose server socket is already destroyed waits out the ~30s close
  // handshake, which vitest reports as a timeout rather than as the leak.
  await server?.close();
  for (const s of sockets.splice(0)) s.terminate();
  server = null;
});

async function boot(jev: JevClient): Promise<SurfaceServer> {
  const session = createSession();
  server = await createSurfaceServer({
    deps: { graph: buildGraph({ session }), jev, content: stubContentSource, logPath: null },
    log: () => {},
  });
  return server;
}

function connect(url: string): {
  socket: WebSocket;
  frames: ServerMessage[];
  open: Promise<void>;
  waitFor(predicate: (f: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
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
    waitFor(predicate, timeoutMs = 5000): Promise<ServerMessage> {
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

describe('the real graph over the websocket', () => {
  it('delivers a schema-valid structure and content update to the device', async () => {
    const s = await boot(createReplayJevClient(NEW_TASK));
    const client = connect(s.url);
    await client.open;

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'what should I make tonight' }));
    const end = (await client.waitFor((f) => f.type === 'turn-end')) as Extract<ServerMessage, { type: 'turn-end' }>;

    expect(end.outcome).toBe('ok');
    const sent = updates(client.frames);
    expect(sent).toHaveLength(2);
    // Per-turn, monotonic from 0, so the device can tell "nothing was
    // produced" from "something was lost".
    expect(sent.map((u) => u.seq)).toEqual([0, 1]);
    expect(new Set(sent.map((u) => u.turnId))).toEqual(new Set([end.turnId]));

    // Parsed with the device's own schemas, after a JSON round trip through a
    // real socket — not shape-checked in process.
    const structure = StructureUpdateSchema.parse(sent[0]!.update);
    const content = ContentUpdateSchema.parse(sent[1]!.update);
    expect(structure.spec.elements[structure.spec.root]).toBeDefined();
    expect(Object.keys(content.values).length).toBeGreaterThan(0);
    expect(content.generationId).toBe(structure.generationId);
  });


  /**
   * The path the device actually uses, which nothing had ever executed:
   * `{type:'action'}` -> `parseClientMessage` -> `runner.say({action,...})` ->
   * `buildGraph`'s input wrapping -> the `act` node -> a projected surface.
   *
   * `ws-server.test.ts`'s action case drives a synthetic one-node graph, and
   * the tests above only send utterances, so every link between the wire's
   * `action` frame and a real state transition was untested. A press is how a
   * judge selects a recipe.
   */
  it('runs a press from the wire through the real graph and paints the result', async () => {
    const s = await boot(createReplayJevClient(NEW_TASK));
    const client = connect(s.url);
    await client.open;

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'what should I make tonight' }));
    const first = (await client.waitFor((f) => f.type === 'turn-end')) as Extract<ServerMessage, { type: 'turn-end' }>;
    expect(first.outcome).toBe('ok');

    client.socket.send(JSON.stringify({ type: 'action', action: 'select_classic_choc_chip', elementId: 'option_1' }));
    const second = (await client.waitFor((f) => f.type === 'turn-end' && f.turnId !== first.turnId)) as Extract<ServerMessage, { type: 'turn-end' }>;

    expect(second.outcome).toBe('ok');
    // No `error` frame: the server no longer refuses control events.
    expect(client.frames.some((f) => f.type === 'error')).toBe(false);

    const painted = updates(client.frames).filter((u) => u.turnId === second.turnId);
    expect(painted).toHaveLength(2);
    const structure = StructureUpdateSchema.parse(painted[0]!.update);
    const content = ContentUpdateSchema.parse(painted[1]!.update);

    // The recipe really opened: the surface carries the batch fader and the
    // start button that `item_detail` declares, and its copy is the seeded
    // recipe's, computed in `domain/`.
    const actions = Object.values(structure.spec.elements)
      .map((e) => e.on?.press?.action ?? e.on?.range?.action)
      .filter(Boolean);
    expect(actions).toContain('set_amount');
    expect(actions).toContain('begin');
    expect(content.values.subtitle?.text).toContain('18 cookies');
  });

  /**
   * Barge-in over the wire. `decide` is slowed so the second utterance
   * genuinely lands mid-turn — with the projected path at well under a
   * millisecond, an unslowed first turn finishes before the second frame is
   * even read, and the test would pass without proving anything.
   *
   * What this proves is the SOCKET half of done-when 6: nothing from the
   * interrupted turn reaches the device. Measured, not assumed: with
   * `createTurnRunner.say`'s `active?.abort(...)` removed this still passes,
   * because `pump` independently drops updates from a superseded turn. Two
   * defences, and this one is the outer one. The abort itself — the half that
   * stops the spend — is proven in `graph.test.ts`, which does fail under
   * that break.
   */
  it('a second utterance aborts the first, and zero further updates reach the socket', async () => {
    const slow: JevClient = {
      async ask(state, signal) {
        await sleep(250, signal);
        return createReplayJevClient(NEW_TASK).ask(state, signal);
      },
    };
    const s = await boot(slow);
    const client = connect(s.url);
    await client.open;

    client.socket.send(JSON.stringify({ type: 'utterance', text: 'what should I make tonight' }));
    const first = (await client.waitFor((f) => f.type === 'turn-start')) as Extract<ServerMessage, { type: 'turn-start' }>;

    await sleep(60, new AbortController().signal);
    client.socket.send(JSON.stringify({ type: 'utterance', text: 'what should I make tonight' }));
    const second = (await client.waitFor((f) => f.type === 'turn-start' && f.turnId !== first.turnId)) as Extract<ServerMessage, { type: 'turn-start' }>;
    const secondEnd = await client.waitFor((f) => f.type === 'turn-end' && f.turnId === second.turnId);

    // Let anything the aborted turn might still emit have a chance to arrive.
    await sleep(300, new AbortController().signal);

    expect(updates(client.frames).filter((u) => u.turnId === first.turnId)).toEqual([]);
    expect(updates(client.frames).filter((u) => u.turnId === second.turnId)).toHaveLength(2);
    expect(secondEnd).toMatchObject({ type: 'turn-end', outcome: 'ok', updates: 2 });

    const firstEnd = client.frames.find((f) => f.type === 'turn-end' && f.turnId === first.turnId);
    expect(firstEnd).toMatchObject({ outcome: 'aborted', updates: 0 });
  });
});
