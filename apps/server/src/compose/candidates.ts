import type { JevCandidate } from '../contract/compose.js';

/**
 * The candidate pool for the two OPEN-ENDED surfaces — `generic_answer` and
 * `message_drafts`.
 *
 * Open-endedness is the point of these two: `generic_answer` is what answers a
 * judge's unscripted question, and neither is determined by the typed domain
 * model, so there is no projection to write. Everywhere the domain DOES
 * determine the surface, `compose/projected.ts` builds it deterministically
 * instead — `composeBatch` asks a per-candidate membership question, so Jev may
 * legitimately omit any single candidate, and a domain-required row (the eggs
 * of a recipe) must not be omittable by a model (ADR 0001, the amendment).
 *
 * Constraint 1 still holds: Jev never emits a tree. It answers `choice`
 * questions over this fixed list and the library assembles the result.
 *
 * `maxUses` is 1 on every entry, and must stay that way: rebinding can make
 * `$state` and `props.id` per-instance but an ACTION NAME cannot be — it is
 * the catalog identity the hardware rail maps a button to. `jevStructureComposer`
 * refuses `maxUses > 1` for exactly that reason.
 *
 * ---
 *
 * **No candidate carries an `on` binding, and none can.** `JIT_CATALOG`
 * (`packages/renderer/src/catalog.tsx`) is built with `actions: {}` and
 * declares no events on any component, so `experimental_composeSpec`
 * validates any `on` against an empty set and throws
 * `Unknown event press on ListItem` before it asks Jev anything. Measured
 * against live Jev, not inferred: the first unscripted question through the
 * composed path crashed on exactly that.
 *
 * Projected surfaces are unaffected — they build a `SurfaceSpec` directly and
 * never pass through the library's catalog validation, which is why the
 * recipe's buttons work and these cannot.
 *
 * The consequence is real and worth naming rather than working around: a
 * COMPOSED surface has no hardware controls today. `generic_answer` does not
 * need any — it answers a question. `message_drafts` wants a tone fader and a
 * draft to pick, and cannot have them until the catalog declares its events;
 * that is a change in `packages/renderer`, which this workstream does not own.
 *
 * Candidate ids and their content segments are deliberately NOT the element
 * keys the library assigns (`node_0…`) — `rebindComposedSpec` reconciles them,
 * and a pool that hid the difference would exercise nothing.
 */

const bind = (id: string, field: string): { $state: string } => ({ $state: `/content/${id}/${field}` });

export const OPEN_ENDED_CANDIDATES: readonly JevCandidate[] = [
  { id: 'surface', description: 'The one visual surface. Use it as the root.', root: true, maxUses: 1, element: { type: 'Card', props: {} } },
  { id: 'flow', description: 'A vertical flow holding the chosen content.', root: false, maxUses: 1, element: { type: 'Stack', props: {} } },
  {
    id: 'lede', description: 'A short headline naming what this surface is about.', root: false, maxUses: 1,
    element: { type: 'Heading', props: { id: 'lede', pending: bind('lede', 'pending'), reserveLines: 1, text: bind('lede', 'text'), level: 1 } },
  },
  {
    id: 'answer', description: 'The main body: a direct answer or explanation, a few sentences at most.', root: false, maxUses: 1,
    element: { type: 'Text', props: { id: 'answer', pending: bind('answer', 'pending'), reserveLines: 4, text: bind('answer', 'text') } },
  },
  {
    id: 'aside', description: 'One supporting line of secondary detail.', root: false, maxUses: 1,
    element: { type: 'Text', props: { id: 'aside', pending: bind('aside', 'pending'), reserveLines: 2, text: bind('aside', 'text'), tone: 'muted' } },
  },
  {
    id: 'draft_a', description: 'One drafted message, with the recipient as its title.', root: false, maxUses: 1,
    element: { type: 'ListItem', props: { id: 'draft_a', pending: bind('draft_a', 'pending'), reserveLines: 2, title: bind('draft_a', 'title'), detail: bind('draft_a', 'detail'), hasDetail: true } },
  },
  {
    id: 'draft_b', description: 'A second drafted message, for a different recipient or a different tone.', root: false, maxUses: 1,
    element: { type: 'ListItem', props: { id: 'draft_b', pending: bind('draft_b', 'pending'), reserveLines: 2, title: bind('draft_b', 'title'), detail: bind('draft_b', 'detail'), hasDetail: true } },
  },
  {
    id: 'note', description: 'One short caveat or aside about the answer.', root: false, maxUses: 1,
    element: { type: 'Alert', props: { id: 'note', pending: bind('note', 'pending'), reserveLines: 3, text: bind('note', 'text') } },
  },
];

/**
 * The `state.content` the composed spec starts from. Every segment a candidate
 * binds must exist here, or the element paints against `undefined` until the
 * content update lands.
 */
export const OPEN_ENDED_INITIAL_STATE: Record<string, unknown> = {
  content: {
    lede: { pending: true, text: '' },
    answer: { pending: true, text: '' },
    aside: { pending: true, text: '' },
    draft_a: { pending: true, title: '', detail: '' },
    draft_b: { pending: true, title: '', detail: '' },
    note: { pending: true, text: '' },
  },
};
