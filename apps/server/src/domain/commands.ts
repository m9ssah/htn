import type { TemplateId } from '@jit/schema';
import { applyScaleUp, completeStep, findDeviations, planScaleUp, setYield, type TaskState } from './recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from './recipes.js';
import { CHOICE_OPTIONS, CONTACTS } from '../seed.js';

/**
 * What a surface's declared actions actually DO to the task.
 *
 * Every projected surface already names its actions (`next_step`,
 * `choose_ari`, `apply_fix`), and until now nothing consumed them: pressing a
 * button answered "action is not handled yet" and saying "what's next"
 * re-rendered the same step forever, because no path advanced `stepIndex`.
 * This is that path.
 *
 * **No model runs here.** A command is a selection from the finite set the
 * surface itself declared, and its effect is arithmetic on typed state
 * (CLAUDE.md constraint 2). Resolving speech to one of those commands is also
 * deterministic — see `resolveCommand` — which is what makes "what's next"
 * instant instead of a routing round trip that can pick the wrong surface.
 */

export type CommandOutcome = {
  task: TaskState;
  /** Where the command leaves the user. `null` keeps the current surface. */
  template: TemplateId | null;
  /** Contacts chosen so far, for `people_picker`. */
  chosen: readonly string[];
  note: string;
};

export type CommandInput = {
  action: string;
  task: TaskState;
  chosen: readonly string[];
  value?: string | number | boolean;
  now?: number;
};

/** The surfaces a command can leave you on, by name, so a typo cannot invent one. */
const ITEM = 'item_detail';
const STEP = 'focus_step';
const DONE = 'summary_done';
const PICK = 'people_picker';
const DRAFTS = 'message_drafts';
const RECOVERY = 'recovery';
const SHOW_ME = 'show_me';

/**
 * Applies one action. Total: an action nobody defined returns `template: null`
 * and says so, rather than throwing inside a turn.
 */
export function applyCommand(input: CommandInput): CommandOutcome {
  const { action, chosen } = input;
  const now = input.now ?? Date.now();
  const keep = (note: string): CommandOutcome => ({ task: input.task, template: null, chosen, note });

  // choice_cards -> a recipe. Only the seeded chocolate chip is followed end
  // to end; the other two are a real decision, not three framings of one, and
  // picking them says so rather than silently starting a different recipe.
  if (action.startsWith('select_')) {
    const id = action.slice('select_'.length);
    const option = CHOICE_OPTIONS.find((o) => o.id === id);
    if (!option) return keep(`unknown option "${id}"`);
    if (id !== CLASSIC_CHOCOLATE_CHIP.id) {
      return { ...keep(`"${option.title}" is seeded for the picker but has no recipe behind it`), template: ITEM };
    }
    return {
      task: { recipe: CLASSIC_CHOCOLATE_CHIP, scale: 1, stepIndex: 0, inBowl: {}, stepStartedAt: now },
      template: ITEM,
      chosen,
      note: `selected ${option.title}`,
    };
  }

  if (action.startsWith('choose_')) {
    const id = action.slice('choose_'.length);
    const contact = CONTACTS.find((c) => c.id === id);
    if (!contact) return keep(`unknown contact "${id}"`);
    /**
     * Additive, not a toggle.
     *
     * Toggling read fine for touch and was wrong for speech: saying a name
     * that was already picked REMOVED them, so "Ari" appeared to do nothing
     * — the log said "unchose Ari". Saying someone's name can only ever mean
     * include them. Capped at the three the surface says it takes.
     */
    if (chosen.includes(id)) return { task: input.task, template: PICK, chosen, note: `${contact.name} was already chosen` };
    const next = [...chosen, id].slice(0, 3);
    return { task: input.task, template: PICK, chosen: next, note: `chose ${contact.name}` };
  }

  switch (action) {
    case 'begin':
      return {
        task: { ...input.task, stepIndex: 0, stepStartedAt: now },
        template: STEP,
        chosen,
        note: 'started cooking',
      };

    case 'next_step': {
      // `completeStep` is what puts the step's ingredients in the bowl, which
      // is why advancing is a domain call and not `stepIndex + 1`.
      const task = completeStep({ ...input.task, stepStartedAt: now });
      const last = task.stepIndex >= task.recipe.steps.length;
      return { task, template: last ? DONE : STEP, chosen, note: last ? 'finished the last step' : `advanced to step ${task.stepIndex + 1}` };
    }

    case 'prev_step': {
      const stepIndex = Math.max(0, input.task.stepIndex - 1);
      return { task: { ...input.task, stepIndex, stepStartedAt: now }, template: STEP, chosen, note: `back to step ${stepIndex + 1}` };
    }

    case 'start_timer':
      return { task: { ...input.task, timerStartedAt: now }, template: STEP, chosen, note: 'timer started' };

    case 'stop_timer': {
      const { timerStartedAt: _stopped, ...rest } = input.task;
      return { task: rest, template: STEP, chosen, note: 'timer stopped' };
    }

    case 'step_done':
      return { task: input.task, template: DONE, chosen, note: 'marked done' };

    case 'set_amount': {
      const target = typeof input.value === 'number' ? input.value : Number(input.value);
      if (!Number.isFinite(target) || target <= 0) return keep(`set_amount needs a positive number, got ${String(input.value)}`);
      return { task: setYield(input.task, target), template: null, chosen, note: `yield set to ${target}` };
    }

    case 'apply_fix': {
      const deviations = findDeviations(input.task);
      if (deviations.length === 0) return keep('nothing to fix');
      // `applyScaleUp` is idempotent, which is what makes pressing the button
      // twice safe — and a judge will press it twice.
      return { task: applyScaleUp(input.task, planScaleUp(input.task)), template: STEP, chosen, note: 'scaled the batch to match' };
    }

    case 'start_over':
      return {
        task: { ...input.task, scale: 1, stepIndex: 0, inBowl: {}, stepStartedAt: now },
        template: ITEM,
        chosen,
        note: 'started over',
      };

    case 'share':
      // A fresh share starts from nobody. Carrying the previous run's picks
      // into a new one is how a stale selection ends up in a message.
      return { task: input.task, template: PICK, chosen: [], note: 'picking who to text' };

    case 'write_messages':
      if (chosen.length === 0) return { ...keep('nobody chosen yet'), template: PICK };
      return { task: input.task, template: DRAFTS, chosen, note: `drafting for ${chosen.length}` };

    case 'back_to_task':
      /**
       * Leaving a picture returns you to what you were doing.
       *
       * `acknowledge` keeps the surface, which is right for dismissing an
       * answer and wrong for a button labelled "Back to the recipe" — it
       * left the media surface up, which then re-ran its lookup and fetched
       * a second picture.
       */
      return {
        task: input.task,
        template: input.task.timerStartedAt !== undefined || input.task.stepIndex > 0 ? STEP : ITEM,
        chosen,
        note: 'back to the task',
      };

    case 'acknowledge':
      /**
       * Dismissing an answer is not a request to start cooking.
       *
       * This used to return to `focus_step`/`item_detail`, so clicking "Got
       * it" on an answer to "how many calories" dropped you into the recipe
       * — a frame change nobody asked for, which reads as the device doing
       * its own thing. Acknowledging leaves the surface where it is; the
       * user says what they want next.
       */
      return keep('acknowledged');

    default:
      // Picking a draft confirms THAT draft. It does not end the task.
      if (action.startsWith('pick_draft_')) return keep('picked a draft');
      if (action === 'set_preference') return keep('preference is a display axis, not a state change');
      return keep(`no command named "${action}"`);
  }
}

/**
 * "Advance" in the ways people actually say it.
 *
 * The list was `next|continue|go on|after|then`, which missed "move forward"
 * — reported on the device as the step simply not responding. Matching a set
 * of phrasings will always be incomplete, so this is the FAST path only:
 * anything unmatched still goes to the model, which is why a miss costs
 * latency rather than correctness.
 */
const FORWARD = /\b(next|forward|onward|onwards|ahead|proceed|advance|continue|carry on|keep going|go on|move on|after (that|this)|and then|what now|whats after)\b/i;

const forward = (said: string): boolean => FORWARD.test(said);

/**
 * Resolves a spoken phrase to one of the actions the CURRENT surface offers.
 *
 * Deterministic on purpose. "What's next" and "Ari" are selections from a
 * finite, visible list, so matching them in TypeScript is both correct and
 * instant — where routing them through the model cost a round trip and,
 * measured on the device, picked the wrong surface: "Ari" came back as a
 * `correct` route and painted a recovery screen about cookies.
 *
 * Returns `null` when nothing matches, and the utterance goes to the model
 * as normal. This is a fast path, never a replacement for routing.
 */

export function resolveCommand(template: TemplateId | null, utterance: string): string | null {
  const said = utterance.toLowerCase().trim();
  if (!said) return null;
  const has = (...words: string[]): boolean => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(said));

  if (template === PICK) {
    const contact = CONTACTS.find((c) => has(c.name.toLowerCase()));
    if (contact) return `choose_${contact.id}`;
    if (has('send', 'text them', 'done', 'that\'s it', 'go')) return 'write_messages';
  }

  if (template === 'choice_cards') {
    // Match on the distinctive words of each title, not the whole string —
    // nobody says "Classic Chocolate Chip" in full.
    const option = CHOICE_OPTIONS.find((o) =>
      o.title.toLowerCase().split(/\s+/).some((word) => word.length > 3 && has(word.replace(/[^a-z]/g, ''))));
    if (option) return `select_${option.id}`;
  }

  if (template === STEP) {
    // Backwards is checked first: "go back" contains "go", which forwards
    // would otherwise claim.
    // Checked before movement: "start the timer" contains "start".
    if (has('timer', 'countdown')) return said.includes('stop') || said.includes('cancel') ? 'stop_timer' : 'start_timer';
    if (has('back', 'previous', 'undo', 'return')) return 'prev_step';
    if (has('done', 'finished', 'complete', 'thats it')) return 'step_done';
    if (forward(said)) return 'next_step';
  }

  if (template === ITEM) {
    if (has('start', 'begin', 'cook', 'bake', 'make it')) return 'begin';
    if (forward(said)) return 'begin';
  }

  if (template === SHOW_ME) {
    // Moving on from a picture means moving on with the recipe.
    if (forward(said)) return 'next_step';
    if (has('back', 'done', 'close', 'recipe', 'return')) return 'back_to_task';
  }

  if (template === RECOVERY) {
    if (has('scale', 'fix', 'adjust', 'match')) return 'apply_fix';
    if (has('restart', 'over', 'scrap')) return 'start_over';
  }

  if (template === DONE) {
    if (has('share', 'text', 'send', 'tell')) return 'share';
  }

  return null;
}
