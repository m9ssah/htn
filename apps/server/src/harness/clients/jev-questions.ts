import type { Density, FontPairing, Motif, Palette, Radius, TemplateId } from '@jit/schema';
import type { JevState, Route } from '../types.js';

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

// p18c arm E ("FIXED"). Two of these differ from the plain descriptions a
// human would write (`choice_cards`, `generic_answer`) precisely because the
// plain versions were the last two sources of error at 8/9.
export const TEMPLATE_DESCRIPTIONS: Record<TemplateId, string> = {
  choice_cards:
    'The user is deciding WHAT to do and has not chosen yet -- generated options to pick between; a slider scrubs the axis they vary on',
  item_detail: 'The chosen thing, whole, with quantities a slider can rescale',
  focus_step: 'One instruction at a time; sparse; encoder scrubs steps',
  recovery: 'Something went wrong: diagnosis, recommended fix, consequence',
  summary_done: 'The task is done; an open prompt, not a button row',
  people_picker: 'Pick people',
  message_drafts: 'Generated drafts, one per recipient, with a tone axis',
  generic_answer:
    'A question that wants a factual ANSWER and no change to the task. Not for choosing, not for starting something.',
};

export const ROUTE_QUESTION = 'What is the user trying to do to the interface or the task right now?';

// backend/probes/p18_route.py `ROUTES`. Measured 15/16, 0 policy-boundary
// errors (docs/orchestration-plan.md:31-37).
export const ROUTES: Record<Route, string> = {
  new_task:
    'The user is starting a different task, or there is no task yet. What is on screen should be replaced.',
  refine:
    'The same task, but the user wants the CURRENT surface presented differently -- bigger, clearer, denser, a different look. Nothing about the task itself changed.',
  correct:
    'The user is reporting that something in the task went wrong or was done differently than planned -- a wrong amount, a mistake, a correction to what already happened.',
  select: 'The user is choosing one of the things currently on screen.',
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

/** The wire shape of a `choice` question — the only primitive `decide` uses. */
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

/** The 7 batched questions `decide` sends in one call — free per p02 (1q 381ms, 32q 362ms). */
export function buildQuestions(): Record<string, JevChoiceQuestion> {
  return {
    route: choice(ROUTE_QUESTION, ROUTES),
    templateId: choice(TEMPLATE_QUESTION, TEMPLATE_DESCRIPTIONS),
    palette: choice(AXIS_QUESTION('palette'), AXIS_DESCRIPTIONS.palette),
    fontPairing: choice(AXIS_QUESTION('fontPairing'), AXIS_DESCRIPTIONS.fontPairing),
    density: choice(AXIS_QUESTION('density'), AXIS_DESCRIPTIONS.density),
    radius: choice(AXIS_QUESTION('radius'), AXIS_DESCRIPTIONS.radius),
    motif: choice(AXIS_QUESTION('motif'), AXIS_DESCRIPTIONS.motif),
  };
}

/** The wire `state` field — p18's shape (`utterance`/`currentTemplate`/`taskState`). */
export function buildWireState(state: JevState): Record<string, unknown> {
  return { utterance: state.utterance, currentTemplate: state.currentTemplate, taskState: state.taskState };
}
