import type { Density, FontPairing, Motif, Palette, Radius, TemplateId } from '@jit/schema';
import type { JevState, Route } from '../types.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../../domain/recipes.js';

/**
 * The wording and option descriptions Jev is asked with.
 *
 * `ROUTE_QUESTION`/`ROUTES` and `TEMPLATE_QUESTION`/`TEMPLATE_DESCRIPTIONS`
 * are a TUNED ARTEFACT, not documentation — copied verbatim from
 * `backend/probes/p18_route.py` (`ROUTES`) and `backend/probes/p18c_batched_tdesc.py`
 * (the `FIXED` dict, arm E). Changing a word here is a measurement, not an
 * edit: p18b/p18c isolated wording and option-description as the two
 * variables that moved `templateId` accuracy from 1/7 (p18's hypothetical
 * phrasing) to 8/9 (declarative wording) to 9/9, 9/9 stable, 230ms (tuned
 * descriptions on top). See docs/orchestration-plan.md "The shape" for the
 * full arm table before touching either dict.
 *
 * `AXIS_DESCRIPTIONS` is copied from `backend/probes/p14_e2e.py`'s `ADESC`
 * for wording consistency with what was actually measured, but the 5 style
 * axes were not part of p18/p18c's isolation — treat this half as a
 * reasonable starting point, not a tuned result.
 */

// Declarative, not hypothetical — p18b: the hypothetical framing ("If the
// interface were to switch to a new layout, which one fits?") collapsed
// answers onto `generic_answer`, scoring 1/7 against this wording's 7/9.
export const TEMPLATE_QUESTION = 'Which template should the interface switch to?';

// p18c arm E ("FIXED"), then RE-TUNED at p22 — `item_detail`, `focus_step`,
// `people_picker` and `generic_answer` no longer match p18c verbatim.
//
// p18c's 9 cases are all questions whose answers are world knowledge, so its
// `generic_answer` description ("a question that wants a factual ANSWER")
// won them all and nothing pushed back. p22 added questions about the OPEN
// TASK and found the same description swallowed those too: "what are the
// ingredients" 0.93, "what do I do now" 0.35, "who lives closest to me" 0.67
// — all wrong, and wrong in the one direction that breaks constraint 2,
// because `generic_answer`'s content is model-generated. A model asked "what
// are the ingredients" for a 3x batch would GENERATE the quantities. Those
// numbers are computed by `plannedAmount` and belong on `item_detail`.
//
// So the line these descriptions now draw is: does answering require a
// number or a position the task computes? If yes it is a task surface; if it
// is world knowledge it is `generic_answer`. That line reconciles both gold
// sets rather than overwriting one with the other — "how long does it bake"
// is still `generic_answer` (a constant), "what are the ingredients" is
// `item_detail` (scaled), and p18c's 9/9 is held as a regression gate inside
// backend/probes/p22_template_accuracy.mjs.
//
// Measured, 3 consecutive runs: p22's 15 demo cases 15/15, p18c's 9 held-out
// 9/9. Changing a word here is still a measurement — run p22 and read BOTH
// halves of the gate.
export const TEMPLATE_DESCRIPTIONS: Record<TemplateId, string> = {
  choice_cards:
    'The user is deciding WHAT to do and has not chosen yet -- generated options to pick between; a slider scrubs the axis they vary on',
  item_detail:
    'The chosen thing, whole: every part it is made of, the current amount of each, and what it costs. Shows this when asked what is in it, what it needs, or to see it again. A slider rescales the quantities.',
  focus_step:
    'The one instruction the user is on RIGHT NOW, out of the ordered list of them. Shows this when asked what to do next, or told to begin or carry on. Sparse; the encoder scrubs steps.',
  recovery: 'Something went wrong: diagnosis, recommended fix, consequence',
  summary_done: 'The task is done; an open prompt, not a button row',
  people_picker:
    'The people the user could involve -- who they are and how near each one is. Shows this when asked who to pick, who to send to, or which of them is closest.',
  message_drafts: 'Generated drafts, one per recipient, with a tone axis',
  generic_answer:
    'A question about the WORLD, answerable without looking at what is open -- general knowledge, how something works, what something is like. Not for anything the open task already holds: its parts, its amounts, its cost, or which step it is on. Not for choosing, not for starting something.',
};

export const ROUTE_QUESTION = 'What is the user trying to do to the interface or the task right now?';

// backend/probes/p18_route.py `ROUTES`. Measured 15/16, 0 policy-boundary
// errors (docs/orchestration-plan.md:31-37).
export const ROUTES: Record<Route, string> = {
  new_task:
    'The user is starting a different task, or there is no task yet. What is on screen should be replaced.',
  refine:
    'The same task, changed ON PURPOSE. The user is adjusting the plan or the presentation -- a different amount, size, count, or a different look. They are deciding what should happen next; nothing has gone wrong.',
  correct:
    'The user is reporting a MISTAKE that has ALREADY happened -- something was done wrong or differently than planned and now has to be fixed. Not a deliberate change to the plan.',
  select:
    'The user is picking one of the things on screen, or going back to one they were shown before.',
  query: 'The user is asking a question. They want an answer, not a change to the task or to what is on screen.',
  other: 'None of the above fits.',
};

export const AXIS_QUESTION = (axis: string): string => `Which ${axis} best matches the request?`;

export const AXIS_DESCRIPTIONS = {
  palette: {
    slate: 'neutral cool grey',
    mono: 'black and white only',
    rose: 'warm pink accent',
    contrast: 'maximum legibility, high contrast',
  } satisfies Record<Palette, string>,
  fontPairing: {
    system: 'native UI font',
    editorial: 'serif display, literary',
    geometric: 'clean geometric sans',
    mono: 'monospace, technical',
  } satisfies Record<FontPairing, string>,
  density: {
    compact: 'tight spacing, more on screen',
    normal: 'balanced',
    spacious: 'generous whitespace, less on screen',
  } satisfies Record<Density, string>,
  radius: {
    sharp: 'square corners',
    soft: 'slightly rounded',
    round: 'fully rounded',
  } satisfies Record<Radius, string>,
  motif: {
    none: 'no decoration',
    floral: 'botanical',
    geometric: 'geometric pattern',
  } satisfies Record<Motif, string>,
};

/** The wire shape of a `choice` question. */
export type JevChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

const choice = (instructions: string, criteria: Record<string, string>): JevChoiceQuestion => ({
  type: 'choice',
  instructions,
  criteria,
});

/**
 * The wire shape of a `noul` (yes/no) question. `criteria` is required here,
 * not optional as the Python client allows — p06 measured that omitting it
 * is what caused a conservative bias first misattributed to the model
 * (accuracy 0.95 -> 1.00, latency 224ms -> 193ms with it supplied).
 */
export type JevNoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
};

const noul = (instructions: string, criteria: { true: string; false: string }): JevNoulQuestion => ({
  type: 'noul',
  instructions,
  criteria,
});

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

// p14: Jev picks a theme on every utterance, restyling surfaces nobody asked
// to restyle. This is `style`'s only gate.
export const STYLE_GATE_QUESTION = 'Does the utterance ask for the interface to look different?';
export const STYLE_GATE_CRITERIA = {
  true: 'The utterance asks for a different look, feel, colour, density, or decoration',
  false: 'The utterance is about the task, not about how the interface looks',
};

/**
 * The save/track gate.
 *
 * `grocery_added` is a server-side surface, not a `TemplateId`
 * (`packages/schema` is frozen), so Jev cannot select it through the
 * `templateId` question — and adding a ninth option would perturb an artefact
 * tuned to 9/9 (p18c) for a surface that is not a template. A separate `noul`
 * keeps the tuned question untouched and still leaves the decision with the
 * model: nothing in the graph pattern-matches the word "grocery".
 *
 * Criteria are supplied on both arms — p06 measured that omitting them is
 * what produced a conservative bias (0.95 -> 1.00 accuracy, 224ms -> 193ms).
 */
export const SAVE_GATE_QUESTION = 'Does the utterance ask for the current thing to be saved, listed or tracked somewhere?';
export const SAVE_GATE_CRITERIA = {
  true: 'The utterance asks to add, save, record or track what is currently open — onto a shopping or grocery list, a budget or spending tracker, a calendar, a note',
  false: 'The utterance asks for something else: a change to the task, a different surface, an answer to a question, or nothing to do with saving',
};

/**
 * The batch-size question.
 *
 * Deliberately NOT `deviationFactor` reused. Measured: "actually make it three
 * times the batch" does come back `deviationFactor: 3x` at 0.93 — but that
 * question asks "roughly how much of the planned amount actually WENT IN",
 * which is a report about a mistake, and on the same call `deviationIngredient`
 * answered `flour`, an artefact of a forced choice over a list that does not
 * apply. An answer that happens to be the right string for the wrong question
 * is not a measurement, and building the demo's biggest beat on one would
 * break the first time someone said "make it half" about a step.
 *
 * `unchanged` is a real option and the expected answer for most `refine`s —
 * "make this easier to read from far away" is a refine about the look, not the
 * amount. Without it the model must pick a multiplier for every refine, which
 * is the same failure `wantsStyleChange` exists to prevent (p14).
 *
 * The model picks a bucket; `setYield` computes the numbers (constraint 2).
 */
export const BATCH_FACTOR_QUESTION = 'How much of the thing on screen does the user want, compared to what is planned now?';

/** `null` means "no number to compute with", which is what `other` means by construction. */
export const BATCH_FACTORS: Record<string, number | null> = {
  unchanged: 1,
  half: 0.5,
  '1.5x': 1.5,
  '2x': 2,
  '3x': 3,
  other: null,
};

export const BATCH_FACTOR_DESCRIPTIONS: Record<string, string> = {
  unchanged: 'The same amount as now. The utterance is not about the amount at all.',
  half: 'Half as much as the plan currently makes',
  '1.5x': 'One and a half times as much as the plan currently makes',
  '2x': 'Twice as much as the plan currently makes',
  '3x': 'Three times as much as the plan currently makes',
  other: 'A different amount, not covered by the choices above',
};

export const DEVIATION_INGREDIENT_QUESTION = 'Which ingredient is the utterance about?';

/**
 * Built from the one recipe actually being followed right now
 * (`domain/recipes.ts`), not hand-duplicated — honest per CLAUDE.md
 * constraint 6, and it generalises the moment a second real recipe exists:
 * this is the demo's only bake in progress, so there is only one ingredient
 * list a correction utterance could be about.
 */
export const DEVIATION_INGREDIENT_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  CLASSIC_CHOCOLATE_CHIP.ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
);

export const DEVIATION_FACTOR_QUESTION = 'Roughly how much of the planned amount actually went in?';

/**
 * The model classifies which bucket; code does the arithmetic (CLAUDE.md
 * constraint 2) — `null` means "not a number `applyDeviation` can use",
 * which is what `other` means by construction. Single source of truth for
 * both the question's criteria (below) and `project`'s conversion, so the
 * two can't drift apart.
 */
export const DEVIATION_FACTORS: Record<string, number | null> = {
  half: 0.5,
  '1.5x': 1.5,
  '2x': 2,
  '3x': 3,
  other: null,
};

export const DEVIATION_FACTOR_DESCRIPTIONS: Record<string, string> = {
  half: 'About half of what the plan called for',
  '1.5x': 'About one and a half times what the plan called for',
  '2x': 'About twice what the plan called for',
  '3x': 'About three times what the plan called for',
  other: 'Some other amount, not covered by the choices above',
};

/** The 12 batched questions `decide` sends in one call — free per p02 (1q 381ms, 32q 362ms). */
export function buildQuestions(): Record<string, JevQuestion> {
  return {
    route: choice(ROUTE_QUESTION, ROUTES),
    templateId: choice(TEMPLATE_QUESTION, TEMPLATE_DESCRIPTIONS),
    palette: choice(AXIS_QUESTION('palette'), AXIS_DESCRIPTIONS.palette),
    fontPairing: choice(AXIS_QUESTION('fontPairing'), AXIS_DESCRIPTIONS.fontPairing),
    density: choice(AXIS_QUESTION('density'), AXIS_DESCRIPTIONS.density),
    radius: choice(AXIS_QUESTION('radius'), AXIS_DESCRIPTIONS.radius),
    motif: choice(AXIS_QUESTION('motif'), AXIS_DESCRIPTIONS.motif),
    wantsStyleChange: noul(STYLE_GATE_QUESTION, STYLE_GATE_CRITERIA),
    wantsSaved: noul(SAVE_GATE_QUESTION, SAVE_GATE_CRITERIA),
    batchFactor: choice(BATCH_FACTOR_QUESTION, BATCH_FACTOR_DESCRIPTIONS),
    deviationIngredient: choice(DEVIATION_INGREDIENT_QUESTION, DEVIATION_INGREDIENT_DESCRIPTIONS),
    deviationFactor: choice(DEVIATION_FACTOR_QUESTION, DEVIATION_FACTOR_DESCRIPTIONS),
  };
}

/** The wire `state` field — p18's shape (`utterance`/`currentTemplate`/`taskState`). */
export function buildWireState(state: JevState): Record<string, unknown> {
  return { utterance: state.utterance, currentTemplate: state.currentTemplate, taskState: state.taskState };
}
