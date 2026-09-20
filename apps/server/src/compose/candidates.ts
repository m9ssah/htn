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
 * The pool is bounded so `getActions()` cannot silently return `[]`: at most
 * 4 press/toggle/text elements and at most 1 range, the device's counts.
 * Here that is 3 presses and 1 range.
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
    element: { type: 'ListItem', props: { id: 'draft_a', pending: bind('draft_a', 'pending'), reserveLines: 2, title: bind('draft_a', 'title'), detail: bind('draft_a', 'detail'), hasDetail: true, interactive: true }, on: { press: { action: 'pick_draft_a' } } },
  },
  {
    id: 'draft_b', description: 'A second drafted message, for a different recipient or a different tone.', root: false, maxUses: 1,
    element: { type: 'ListItem', props: { id: 'draft_b', pending: bind('draft_b', 'pending'), reserveLines: 2, title: bind('draft_b', 'title'), detail: bind('draft_b', 'detail'), hasDetail: true, interactive: true }, on: { press: { action: 'pick_draft_b' } } },
  },
  {
    id: 'tone', description: 'A fader for how the drafts should read, from brief to warm.', root: false, maxUses: 1,
    element: { type: 'Slider', props: { id: 'tone', pending: bind('tone', 'pending'), label: bind('tone', 'label'), minLabel: bind('tone', 'minLabel'), maxLabel: bind('tone', 'maxLabel'), min: 0, max: 2, step: 1, value: 1 }, on: { range: { action: 'set_tone' } } },
  },
  {
    id: 'dismiss', description: 'A single button that returns to what was open before.', root: false, maxUses: 1,
    element: { type: 'Button', props: { id: 'dismiss', pending: bind('dismiss', 'pending'), text: bind('dismiss', 'text'), variant: 'secondary' }, on: { press: { action: 'back_to_recipe' } } },
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
    tone: { pending: true, label: '', minLabel: '', maxLabel: '' },
    dismiss: { pending: true, text: '' },
  },
};
