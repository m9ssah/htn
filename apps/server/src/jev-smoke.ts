import { StructureUpdateSchema, type SurfaceSpec } from '@jit/schema';
import { jevStructureComposer, type JevCandidate } from './orchestration.js';

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is required. Add it to .env before running npm run jev:smoke.');

const contentPath = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

/**
 * A deliberately small, atomic candidate pool. Jev can choose and arrange
 * these fixed recipes, but cannot invent a component, property, or binding.
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

const composer = jevStructureComposer({
  apiKey,
  candidates,
  initialState,
  context: { device: '800×480 touch display', catalogVersion: 'jit-device.v2' },
  maxWidth: 640,
});

let finalUpdate: unknown;
for await (const update of composer.compose({
  requestId: 'jev-live-smoke',
  generationId: `jev-live-${Date.now()}`,
  intent: 'Create a compact surface that helps a student choose one focused study task for tomorrow.',
})) {
  finalUpdate = update;
}

const parsed = StructureUpdateSchema.parse(finalUpdate);
if (parsed.status !== 'complete') throw new Error(`Jev completed with status ${parsed.status}.`);
assertSafeSurface(parsed.spec);
console.log(`JEV-SMOKE PASS — ${Object.keys(parsed.spec.elements).length} catalog-constrained elements composed.`);
