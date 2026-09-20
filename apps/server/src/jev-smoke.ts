import { StructureUpdateSchema, type SurfaceSpec } from '@jit/schema';
import { jevEvaluator, jevStructureComposer, type JevCandidate } from './contract/compose.js';
import { deriveContentRequest } from './contract/content.js';
import { JevHttpClient } from './harness/clients/jev.js';

/**
 * The live composition smoke test. One of the entry points that touch the
 * real network; never run by `npm test`.
 *
 *   npm run jev:smoke
 *
 * It runs through `jevEvaluator`, i.e. our own `JevHttpClient` against
 * `api.typesafe.ai` — the library's own gateway adapter wants a Vercel AI
 * Gateway key and answers HTTP 401 to this project's TypeSafe credential, so
 * the gateway path cannot be smoked with the key this repo has.
 */

const contentPath = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

/**
 * A deliberately small, atomic candidate pool. Jev can choose and arrange
 * these fixed recipes, but cannot invent a component, property, or binding.
 *
 * The candidate ids and their content segments are deliberately NOT the
 * element keys the library assigns (`node_0…`): `rebindComposedSpec` is what
 * reconciles them, and a pool that hid the difference would smoke-test
 * nothing.
 */
const candidates: JevCandidate[] = [
  { id: 'surface', description: 'The one visual surface. Use it as the root.', root: true, maxUses: 1, element: { type: 'Card', props: {} } },
  { id: 'vertical-flow', description: 'A vertical flow of the selected content.', root: false, maxUses: 1, element: { type: 'Stack', props: {} } },
  {
    id: 'title', description: 'A concise title for the user’s requested plan.', root: false, maxUses: 1,
    element: { type: 'Heading', props: { id: 'title', pending: contentPath('title', 'pending'), reserveLines: 1, text: contentPath('title', 'text'), level: 1 } },
  },
  {
    id: 'explanation', description: 'One short supporting explanation.', root: false, maxUses: 1,
    element: { type: 'Text', props: { id: 'explanation', pending: contentPath('explanation', 'pending'), reserveLines: 2, text: contentPath('explanation', 'text'), tone: 'muted' } },
  },
  {
    id: 'choice', description: 'One non-interactive option with a title and concise meta information.', root: false, maxUses: 1,
    element: { type: 'ListItem', props: { id: 'choice', pending: contentPath('choice', 'pending'), reserveLines: 1, title: contentPath('choice', 'title'), meta: contentPath('choice', 'meta'), hasDetail: false } },
  },
];

const initialState = {
  content: {
    title: { pending: true, text: '' },
    explanation: { pending: true, text: '' },
    choice: { pending: true, title: '', meta: '' },
  },
};

function assertSafeSurface(spec: SurfaceSpec) {
  const count = Object.keys(spec.elements).length;
  if (count < 2 || count > 24) throw new Error(`Jev returned ${count} elements; expected 2–24.`);
  if (spec.elements[spec.root]?.type !== 'Card') throw new Error(`Jev chose a non-surface root: ${spec.root}.`);
}

// $1 is a circuit breaker for a runaway loop, not a budget — one composition
// is two calls at roughly $0.00014 in total.
const client = new JevHttpClient({ maxUsd: 1.0 });
const composer = jevStructureComposer({
  evaluate: jevEvaluator(client),
  candidates,
  initialState,
  context: { device: '800×480 touch display', catalogVersion: 'jit-device.v2' },
  maxWidth: 640,
});

const intent = process.argv.slice(2).join(' ') || 'Create a compact surface that helps a student choose one focused study task for tomorrow.';
const controller = new AbortController();

let finalUpdate: unknown;
for await (const event of composer.compose({ requestId: 'jev-live-smoke', generationId: `jev-live-${Date.now()}`, intent }, controller.signal)) {
  if (event.kind === 'unavailable') throw new Error(`JEV-SMOKE UNAVAILABLE — ${event.reason}`);
  finalUpdate = event.update;
  if (event.completion) console.log(`stopReason=${event.completion.stopReason} steps=${event.completion.steps} inputTokens=${event.completion.inputTokens} elapsed=${event.completion.elapsedMs}ms`);
}

const parsed = StructureUpdateSchema.parse(finalUpdate);
if (parsed.status !== 'complete') throw new Error(`Jev completed with status ${parsed.status}.`);
assertSafeSurface(parsed.spec);

// The composition is only useful if content can reach it: every generated
// prop must resolve against the element key the library assigned.
const { request, unresolved } = deriveContentRequest({
  requestId: parsed.requestId, locale: 'en-CA', intent, context: {}, spec: parsed.spec,
});
if (unresolved.length > 0) throw new Error(`JEV-SMOKE FAIL — unresolved bindings: ${unresolved.map((entry) => entry.reason).join(' ')}`);
for (const target of request.targets) {
  const element = parsed.spec.elements[target.elementId]!;
  for (const field of target.fields) {
    const binding = element.props[field.name] as { $state?: string } | undefined;
    if (binding?.$state !== `/content/${target.elementId}/${field.name}`) throw new Error(`JEV-SMOKE FAIL — ${target.elementId}.${field.name} binds ${String(binding?.$state)}.`);
  }
}
console.log(`spend: $${client.usd.toFixed(5)} over ${client.requests} requests`);
console.log(`JEV-SMOKE PASS — ${Object.keys(parsed.spec.elements).length} catalog-constrained elements composed, ${request.targets.length} content targets all bound to their element key.`);
