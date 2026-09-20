import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stubContentSource } from './harness/clients/content.js';
import { OpenAiContentModel, stubContentModel } from './harness/clients/content-model.js';
import { getRealJevClient, stubJevClient } from './harness/clients/jev.js';
import { realResearchClient } from './harness/clients/research.js';
import { createGraph, createSession } from './graph.js';
import { createSurfaceServer } from './ws-server.js';

/**
 * The server entry point.
 *
 *   npm run serve            # 127.0.0.1:8787
 *   JIT_PORT=9000 npm run serve
 *
 * P4: the concrete graph (`./graph.ts`) is wired. Jev is the real client when
 * a TypeSafe key is present and the stub otherwise — the boot log says which,
 * because a stub Jev routes every utterance to `generic_answer` and that must
 * never look like the device understanding you (constraint 5).
 */

/**
 * Load `.env` from the repo root if it is there.
 *
 * `process.loadEnvFile` is Node's own (20.6+), so this costs no dependency,
 * and it does NOT overwrite a variable already in the environment — an
 * explicit `OPENAI_KEY=... npm run serve` still wins over the file.
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
 * The real content model only when it is actually configured, and the boot log
 * says which one is live either way. A silent stub fallback would make an
 * unconfigured endpoint look like a working one until a judge read the copy
 * (constraint 5); the stub's own placeholder strings are deliberately
 * unmistakable for the same reason.
 */
const contentModelKey = process.env.JIT_CONTENT_MODEL_KEY ?? process.env.OPENAI_KEY;
const contentModelUrl = process.env.JIT_CONTENT_MODEL_URL ?? (contentModelKey ? 'https://api.openai.com/v1/chat/completions' : undefined);
const contentModel = contentModelKey || process.env.JIT_CONTENT_MODEL_URL ? new OpenAiContentModel() : stubContentModel;

/**
 * Real Jev when there is a key to spend, stub otherwise. The stub answers
 * `query`/`generic_answer` at 0.5 confidence for every utterance, so a device
 * running on it looks responsive while understanding nothing — named in the
 * boot log rather than left to be discovered on stage.
 */
const hasJevKey = Boolean(process.env.TYPESAFE_API_KEY) || existsSync(join(homedir(), '.config', 'typesafe', 'env'));
const jev = hasJevKey ? getRealJevClient() : stubJevClient;

const session = createSession();

const server = await createSurfaceServer({
  port,
  host,
  deps: { graph: createGraph(session), jev, content: stubContentSource, contentModel, fetch: realResearchClient },
});

process.stderr.write(
  `${JSON.stringify({
    event: 'listening',
    url: server.url,
    graph: 'wired: decide -> policy -> paint -> style',
    jev: hasJevKey ? 'live' : 'STUB — every utterance routes to generic_answer',
    contentModel: contentModelUrl ? `live: ${contentModelUrl}` : 'STUB — set OPENAI_KEY (or JIT_CONTENT_MODEL_URL) for a real model',
    recipe: session.task.recipe.name,
  })}\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
