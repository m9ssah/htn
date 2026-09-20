import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevHttpClient } from './harness/clients/jev.js';
import type { JevState } from './harness/types.js';

/**
 * Records one fixture per policy branch, from `backend/probes/p18_route.py`'s
 * `CASES` — this is the whole reason P3 runs before P2
 * (docs/orchestration-plan.md "Why P3 moves ahead of P2"): `policy`'s table
 * tests need to be written against real recorded distributions, not a guess.
 * A fixture recorded with `currentTemplate: null` can only ever exercise the
 * `new_task`/`query` branches, so this deliberately covers all four.
 *
 * Not run by `npm test`. One explicit, deliberate recording pass:
 *
 *   npm run record-jev-fixtures
 */
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/jev/recorded');

const CASES: ReadonlyArray<{ name: string; state: JevState }> = [
  {
    name: 'new_task',
    state: { utterance: 'what should I make tonight', currentTemplate: null, taskState: 'nothing started' },
  },
  {
    name: 'refine',
    state: {
      utterance: "make it high contrast, I can't read this",
      currentTemplate: 'item_detail',
      taskState: 'cookie recipe open',
    },
  },
  {
    name: 'correct',
    state: {
      utterance: 'I put in too much sugar',
      currentTemplate: 'focus_step',
      taskState: 'step 3 of 6, flour+butter in bowl',
    },
  },
  {
    name: 'select',
    state: { utterance: 'the second one', currentTemplate: 'choice_cards', taskState: '3 recipe options on screen' },
  },
];

const client = new JevHttpClient({ maxUsd: 5.0 });
mkdirSync(OUT_DIR, { recursive: true });

for (const { name, state } of CASES) {
  const { raw } = await client.askRecording(state, AbortSignal.timeout(5000));
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ state, response: raw }, null, 2)}\n`);
  console.log(`${name} -> ${path}`);
}
console.log(`spend: $${client.usd.toFixed(5)} over ${client.requests} requests`);
