import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TemplateId } from '@jit/schema';
import { JevHttpClient } from './harness/clients/jev.js';
import type { JevState } from './harness/types.js';

/**
 * The one entry point in this repo that spends real money and touches the
 * real network — deliberately separate from `npm run node --`, which stays
 * CI-safe on stub/replay clients. Not run by `npm test`.
 *
 *   npm run live-jev -- "make it high contrast" --template item_detail --task "cookie recipe open" [--record path.json]
 *
 * `--template`/`--task` matter: `route`/`templateId` are unanswerable from
 * the utterance alone (p18), so a fixture recorded with `currentTemplate:
 * null` can only ever exercise the `new_task`/`query` policy branches — P2's
 * `refine`/`correct`/`select` table tests need fixtures recorded WITH a
 * current template.
 *
 * Prints cold vs several warm latencies (first call pays the TLS handshake,
 * later ones reuse the keep-alive socket — docs/orchestration-plan.md
 * "Reliability"), total spend, and the parsed answer. `--record` additionally
 * writes a `{ state, response }` fixture for `createReplayJevClient`/P2.
 */
const argv = process.argv.slice(2);
function takeFlag(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

const recordPath = takeFlag('--record');
const currentTemplate = (takeFlag('--template') ?? null) as TemplateId | null;
const taskState = takeFlag('--task') ?? 'nothing started';
const utterance = argv.join(' ') || 'what should I make tonight';

// $5 is a circuit breaker for a runaway loop, not a real budget — a normal
// run here is a handful of calls at ~$0.00003 each.
const client = new JevHttpClient({ maxUsd: 5.0 });
const state: JevState = { utterance, currentTemplate, taskState };
const signal = (): AbortSignal => AbortSignal.timeout(5000);

const t0 = performance.now();
const cold = await client.askRecording(state, signal());
console.log(`cold: ${(performance.now() - t0).toFixed(1)}ms`);

const warmMs: number[] = [];
let lastWarm = cold;
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  lastWarm = await client.askRecording(state, signal());
  warmMs.push(performance.now() - t);
}
console.log(`warm: ${warmMs.map((ms) => ms.toFixed(1)).join(', ')}ms`);
console.log(`spend: $${client.usd.toFixed(5)} over ${client.requests} requests`);
console.log(JSON.stringify(cold.answer, null, 2));

if (recordPath) {
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify({ state, response: lastWarm.raw }, null, 2)}\n`);
  console.log(`recorded -> ${recordPath}`);
}
