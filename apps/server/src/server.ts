import { realContentSource } from './harness/clients/content.js';
import { getRealJevClient } from './harness/clients/jev.js';
import { buildGraph, liveComposer } from './graph.js';
import { createSession } from './session.js';
import { createSurfaceServer } from './ws-server.js';

/**
 * The server entry point.
 *
 *   npm run serve            # 127.0.0.1:8787
 *   JIT_PORT=9000 npm run serve
 *
 * One device, one session, one graph. The session is created here and lives
 * for the process: the device holds one continuous task, and `ws-server.ts`
 * refuses a second connection precisely so two devices cannot race for it.
 *
 * `warmup()` is a real (one-question) Jev call on the same client instance
 * that then serves every turn, so the first utterance does not pay the ~260ms
 * TLS handshake that is 63% of a cold call.
 */

const port = Number(process.env.JIT_PORT ?? 8787);
const host = process.env.JIT_HOST ?? '127.0.0.1';

const jev = getRealJevClient();
const session = createSession();
const graph = buildGraph({ session, composer: liveComposer(jev) });

const server = await createSurfaceServer({
  port,
  host,
  deps: { graph, jev, content: realContentSource },
});

// Never fatal: a demo that cannot boot because a warmup call timed out is a
// worse failure than a slow first turn. The reason is reported, not hidden.
try {
  await jev.warmup();
  process.stderr.write(`${JSON.stringify({ event: 'jev-warm', requests: jev.requests })}\n`);
} catch (err) {
  process.stderr.write(`${JSON.stringify({ event: 'jev-warmup-failed', error: String(err) })}\n`);
}

process.stderr.write(`${JSON.stringify({ event: 'listening', url: server.url, graph: 'decide -> policy -> style -> structure -> content' })}\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
