import type { Patch } from '@jit/schema';
import { realContentSource } from './harness/clients/content.js';
import { generate, type GeneratedTemplateId } from './harness/nodes/generate.js';
import type { Ctx, Event, JevClient, PatchSink } from './harness/types.js';

/**
 * The one entry point that spends real money and shells out to `claude -p` —
 * deliberately separate from `npm run node --`, which stays CI-safe on
 * stub/replay sources. Not run by `npm test`. Mirrors `live-jev.ts`.
 *
 *   npm run live-generate -- generic_answer "what temperature for cookies"
 *
 * Reports time-to-first-slot (spawn to the first `sink.emit`), against the
 * ~1.2s projection in CLAUDE.md's latency budget doc — that figure includes
 * ~570ms of CLI spawn from probe 17's stripped arm; in-process is projected
 * at 600-1000ms.
 */
const [rawTemplate, ...rest] = process.argv.slice(2);
const templateId: GeneratedTemplateId = rawTemplate === 'message_drafts' ? 'message_drafts' : 'generic_answer';
const utterance = rest.join(' ') || 'what temperature should I bake cookies at';

const t0 = performance.now();
let firstSlotMs: number | undefined;
const emitted: Patch[] = [];
const sink: PatchSink = {
  emit(patch) {
    if (firstSlotMs === undefined) firstSlotMs = performance.now() - t0;
    emitted.push(patch);
  },
};

const unusedJev: JevClient = {
  ask() {
    throw new Error('live-generate: jev is not exercised by generate');
  },
};

const events: Event[] = [];
const ctx: Ctx = {
  jev: unusedJev,
  content: realContentSource,
  sink,
  signal: AbortSignal.timeout(30_000),
  now: () => performance.now(),
  telemetry: (e) => events.push(e),
};

await generate.run({ templateId, utterance }, ctx);

console.log(`time to first slot: ${firstSlotMs !== undefined ? `${firstSlotMs.toFixed(1)}ms` : 'never (no slots emitted)'}`);
console.log(`total: ${(performance.now() - t0).toFixed(1)}ms, slots emitted: ${emitted.length}`);
console.log(JSON.stringify(emitted, null, 2));
if (events.length) console.log('telemetry:', JSON.stringify(events, null, 2));
