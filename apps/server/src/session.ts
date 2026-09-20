import {
  completeStep,
  currentYield,
  findDeviations,
  planScaleUp,
  applyScaleUp,
  setYield,
  type TaskState,
} from './domain/recipe.js';
import { RECIPES } from './domain/recipes.js';
import type { SurfaceKind } from './compose/projected.js';

/**
 * The one continuous task, held across turns.
 *
 * `CLAUDE.md`: "the interface is a projection of that state, not a reply to an
 * utterance." A turn is therefore not a fresh start — "actually make it three
 * times the batch" only means anything against a recipe that is already open,
 * and `decide` cannot classify `refine`/`correct`/`select` at all without
 * knowing what is on screen (p18).
 *
 * In memory, one device, no persistence: `ws-server.ts` refuses a second
 * connection precisely so there is only ever one of these.
 */

export type Session = {
  /** `null` until something has been chosen. */
  task: TaskState | null;
  /** What is on screen right now. Feeds Jev's `currentTemplate`. */
  surface: SurfaceKind | null;
  /** `people_picker` selections, by contact id. */
  chosen: Set<string>;
};

export const createSession = (): Session => ({ task: null, surface: null, chosen: new Set() });

/**
 * The one-line task summary Jev is asked with (`JevState.taskState`).
 *
 * Every number in it is computed here, from the typed model — the string is
 * INPUT to the model, never output from it, so constraint 2 is not at stake,
 * but keeping the arithmetic in one place is what stops the prompt and the
 * screen disagreeing.
 */
export function describeTask(session: Session): string {
  const task = session.task;
  if (!task) return 'nothing started';
  const parts = [
    `${task.recipe.name.toLowerCase()} open`,
    `${currentYield(task)} ${task.recipe.yieldUnit}`,
    task.stepIndex < task.recipe.steps.length
      ? `step ${task.stepIndex + 1} of ${task.recipe.steps.length}`
      : 'all steps done',
  ];
  const deviations = findDeviations(task);
  if (deviations.length > 0) parts.push(`${deviations[0]!.name.toLowerCase()} is off plan`);
  return parts.join(', ');
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

/**
 * What a press, toggle or slider scrub does to the task.
 *
 * This is a VOCABULARY table, the same kind as `policy.ts`'s `SELECT_TARGET`,
 * not a script: it maps the action names the surfaces themselves declare
 * (`compose/projected.ts`'s action list) onto domain transitions. Nothing here
 * branches on which beat of a demo we are in, and nothing here knows what
 * order the actions arrive in — pressing `next_step` twice advances twice,
 * pressing `apply_fix` twice is idempotent because `planScaleUp` on an
 * already-scaled state finds no deviation.
 *
 * **No model call, ever.** `CLAUDE.md`: "a physical control must respond
 * within one frame — never on a model call."
 */
export type ActionInput = { action: string; elementId?: string; value?: string | number | boolean };

export type ActionOutcome =
  | { ok: true; surface: SurfaceKind; note: string }
  /** Never a plausible-looking fallback surface: the reason, and no paint. */
  | { ok: false; reason: string };

const SELECT_PREFIX = 'select_';
const CHOOSE_PREFIX = 'choose_';

export function applyAction(session: Session, input: ActionInput): ActionOutcome {
  const { action } = input;

  if (action.startsWith(SELECT_PREFIX)) {
    const id = action.slice(SELECT_PREFIX.length);
    const recipe = RECIPES[id];
    if (!recipe) return { ok: false, reason: `no recipe is seeded for "${id}" — nothing to open` };
    session.task = { recipe, scale: 1, stepIndex: 0, inBowl: {} };
    return { ok: true, surface: 'item_detail', note: `opened ${recipe.name}` };
  }

  if (action.startsWith(CHOOSE_PREFIX)) {
    const id = action.slice(CHOOSE_PREFIX.length);
    if (session.chosen.has(id)) session.chosen.delete(id);
    else session.chosen.add(id);
    return { ok: true, surface: 'people_picker', note: `${session.chosen.size} chosen` };
  }

  const task = session.task;
  if (!task) return { ok: false, reason: `"${action}" needs an open task and there is none` };

  switch (action) {
    case 'begin':
      // Idempotent on purpose: `begin` means "show me the step I'm on", not
      // "start from zero". Resetting here would undo a correction the user
      // already confirmed.
      return { ok: true, surface: 'focus_step', note: `step ${task.stepIndex + 1}` };

    case 'next_step': {
      session.task = completeStep(task);
      return { ok: true, surface: 'focus_step', note: `step ${session.task.stepIndex + 1}` };
    }

    case 'prev_step': {
      // Only the cursor moves. What is in the bowl already went in, and no
      // button can un-add it — the same reason `planScaleUp` cannot fix an
      // under-addition.
      session.task = { ...task, stepIndex: Math.max(0, task.stepIndex - 1) };
      return { ok: true, surface: 'focus_step', note: `step ${session.task.stepIndex + 1}` };
    }

    case 'step_done': {
      session.task = completeStep(task);
      return { ok: true, surface: 'summary_done', note: 'finished' };
    }

    case 'apply_fix': {
      const plan = planScaleUp(task);
      if (plan.newScale === task.scale) {
        return { ok: false, reason: 'nothing in the bowl deviates from the plan — there is nothing to scale up to' };
      }
      session.task = applyScaleUp(task, plan);
      return { ok: true, surface: 'item_detail', note: `scaled to ${plan.newYield} ${task.recipe.yieldUnit}` };
    }

    case 'start_over': {
      session.task = { recipe: task.recipe, scale: 1, stepIndex: 0, inBowl: {} };
      return { ok: true, surface: 'item_detail', note: 'started over' };
    }

    case 'set_amount': {
      const target = Number(input.value);
      if (!Number.isFinite(target)) return { ok: false, reason: `set_amount needs a numeric value, got ${String(input.value)}` };
      session.task = setYield(task, Math.round(target));
      return { ok: true, surface: 'item_detail', note: `${currentYield(session.task)} ${task.recipe.yieldUnit}` };
    }

    // The effort fader re-renders the same decision; it changes no task state.
    case 'set_preference':
      return { ok: true, surface: 'choice_cards', note: 'preference moved' };

    case 'back_to_recipe':
      return { ok: true, surface: 'item_detail', note: 'back to the recipe' };

    case 'share':
      return { ok: true, surface: 'people_picker', note: 'sharing' };

    case 'write_messages':
      if (session.chosen.size === 0) return { ok: false, reason: 'no one is selected to write to' };
      return { ok: true, surface: 'message_drafts', note: `${session.chosen.size} recipient(s)` };

    default:
      return { ok: false, reason: `unknown action "${action}"` };
  }
}
