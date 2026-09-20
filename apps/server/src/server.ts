import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realContentSource } from './harness/clients/content.js';
import { stubContentModel } from './harness/clients/content-model.js';
import { realResearchClient } from './harness/clients/research.js';
import { getRealJevClient, stubJevClient } from './harness/clients/jev.js';
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

/**
 * Load `.env` from the repo root if it is there.
 *
 * `process.loadEnvFile` is Node's own (20.6+), so this costs no dependency,
 * and it does NOT overwrite a variable already in the environment — an
 * explicit `TYPESAFE_API_KEY=... npm run serve` still wins over the file.
 *
 * `JEV_API` is aliased onto `TYPESAFE_API_KEY` because that is the name
 * `clients/jev.ts` reads. Without this the key sits in `.env` and the server
 * silently runs on the stub Jev.
 */
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.TYPESAFE_API_KEY && process.env.JEV_API) process.env.TYPESAFE_API_KEY = process.env.JEV_API;

const port = Number(process.env.JIT_PORT ?? 8787);
const host = process.env.JIT_HOST ?? '127.0.0.1';

/**
 * Real Jev when there is a key to spend, stub otherwise. The stub answers
 * `query`/`generic_answer` at 0.5 confidence for every utterance, so a device
 * running on it looks responsive while understanding nothing — named in the
 * boot log rather than left to be discovered on stage (constraint 5).
 */
const hasJevKey = Boolean(process.env.TYPESAFE_API_KEY) || existsSync(join(homedir(), '.config', 'typesafe', 'env'));

/**
 * Kept as its own binding rather than folded into `jev`: `warmup()` and the
 * composer both need the concrete HTTP client, and `stubJevClient` is the
 * narrower `JevClient`. Without the split, one `jev` would have to be typed
 * down to the interface and the composer could not be built at all.
 *
 * With no key there is no composer, so `generic_answer`/`message_drafts` are
 * `unavailable` rather than silently empty — which is what constraint 5 asks
 * for, and it is already reported in the boot log below.
 */
const realJev = hasJevKey ? getRealJevClient() : null;
const jev = realJev ?? stubJevClient;
const session = createSession();
const graph = buildGraph({ session, ...(realJev ? { composer: liveComposer(realJev) } : {}) });

const server = await createSurfaceServer({
  port,
  host,
  // `contentModel`/`fetch` belong to the `generate`/`research` nodes, which
  // this graph does not wire — passed because `TurnDeps` requires them, not
  // because anything on this path calls them.
  deps: { graph, jev, content: realContentSource, contentModel: stubContentModel, fetch: realResearchClient },
});

// Never fatal: a demo that cannot boot because a warmup call timed out is a
// worse failure than a slow first turn. The reason is reported, not hidden.
// Skipped on the stub, which has no handshake to pay and no spend to warm.
if (realJev) {
  try {
    await realJev.warmup();
    process.stderr.write(`${JSON.stringify({ event: 'jev-warm', requests: realJev.requests })}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ event: 'jev-warmup-failed', error: String(err) })}\n`);
  }
}

process.stderr.write(
  `${JSON.stringify({
    event: 'listening',
    url: server.url,
    graph: 'decide -> act -> policy -> style -> structure -> content',
    jev: hasJevKey ? 'live' : 'STUB — every utterance routes to generic_answer',
    recipe: session.task?.recipe.name ?? 'none open',
  })}\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
