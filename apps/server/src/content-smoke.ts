import type { SurfaceSpec } from '@jit/schema';
import { contentUpdateFrom, deriveContentRequest, validateContentResult } from './contract/content.js';
import { OpenAiContentModel } from './harness/clients/content-model.js';

/**
 * The live content-model smoke test. Touches the real network; never run by
 * `npm test`.
 *
 *   JIT_CONTENT_MODEL_URL=<host>/v1/chat/completions \
 *   JIT_CONTENT_MODEL_NAME=<served adapter name> \
 *   JIT_CONTENT_MODEL_KEY=<key, if the host needs one> \
 *   npm run content:smoke -- "plan a study session for tomorrow"
 *
 * It runs the exact path the device will: derive targets from a spec's own
 * bindings, ask the fine-tuned model, and validate the answer against the
 * request. A green run means the deployed adapter speaks the contract it was
 * trained on; a red one names the element and rule that failed, rather than
 * leaving a surface half-filled at demo time.
 */

const contentPath = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

/**
 * Exercises five components with different field kinds — required and
 * optional, short and long — rather than one Heading. A model that only ever
 * answers a title would pass a single-target smoke and still fail on a real
 * surface.
 */
const spec: SurfaceSpec = {
  root: 'surface',
  elements: {
    surface: { type: 'Card', props: {} },
    flow: { type: 'Stack', props: {} },
    title: { type: 'Heading', props: { id: 'title', text: contentPath('title', 'text'), level: 1 } },
    tag: { type: 'Badge', props: { id: 'tag', text: contentPath('tag', 'text') } },
    blurb: { type: 'Text', props: { id: 'blurb', text: contentPath('blurb', 'text'), tone: 'muted' } },
    option: { type: 'ListItem', props: { id: 'option', title: contentPath('option', 'title'), detail: contentPath('option', 'detail'), hasDetail: true } },
    go: { type: 'Button', props: { id: 'go', text: contentPath('go', 'text') } },
  },
};

const intent = process.argv.slice(2).join(' ') || 'Help a student choose one focused study task for tomorrow.';

const { request, unresolved } = deriveContentRequest({
  requestId: `content-smoke-${Date.now()}`,
  locale: 'en-CA',
  intent,
  context: {},
  spec,
});
if (unresolved.length > 0) throw new Error(`CONTENT-SMOKE FAIL — unresolved bindings: ${unresolved.map((entry) => entry.reason).join(' ')}`);

const model = new OpenAiContentModel();
const started = performance.now();
const raw = await model.fill(request, AbortSignal.timeout(30_000));
const elapsed = Math.round(performance.now() - started);

const validation = validateContentResult(request, raw);
const update = contentUpdateFrom(request, validation, { generationId: `content-smoke-${Date.now()}` });

for (const [elementId, values] of Object.entries(update.values)) {
  const filled = Object.entries(values).map(([field, value]) => `${field}=${JSON.stringify(value)}`).join(' ');
  console.log(`  ${elementId}: ${filled || '(unfilled)'}`);
}

if (validation.rejected.length > 0) {
  for (const entry of validation.rejected) console.error(`  REJECTED ${entry.elementId}: ${entry.reason}`);
  throw new Error(`CONTENT-SMOKE FAIL — ${validation.rejected.length}/${request.targets.length} targets rejected.`);
}

// Not a budget assertion — the deployment cold-starts, and a first call after
// a scale-to-zero is not what the 1.5s content budget describes. Reported so
// a warm number can be compared against it.
console.log(`CONTENT-SMOKE PASS — ${request.targets.length} targets filled and validated in ${elapsed}ms.`);
