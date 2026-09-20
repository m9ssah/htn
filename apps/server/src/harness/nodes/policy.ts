import type { SlotId, TemplateId } from '@jit/schema';
import type { Node, Route } from '../types.js';

/**
 * `policy` decides whether to actually APPLY Jev's `templateId` — `decide`
 * only hands back what Jev said. This is measured, not invented: p18 found
 * that on all nine `refine`/`correct`/`select` cases Jev's `templateId` had
 * to be discarded (docs/orchestration-plan.md "The shape"). Confidence is
 * deliberately not consulted anywhere below — p13/p18 measured it does not
 * separate right answers from wrong ones.
 */
export type PolicyInput = {
  route: Route;
  /** What Jev's `templateId` question answered — used on `new_task`/`query`,
   * and as the total-fallback when there is no current surface to keep. */
  jevTemplateId: TemplateId;
  currentTemplate: TemplateId | null;
  /**
   * `correct` only. Whether the tracked `TaskState` already shows a
   * deviation from plan — the caller computes this (typically
   * `findDeviations(state).length > 0`) so `policy` stays domain-agnostic
   * and does not need to import `apps/server/src/domain`.
   */
  hasDeviation?: boolean;
  /**
   * Whether a task is actually open. The caller computes it (`task !== null`)
   * so `policy` stays domain-agnostic, same as `hasDeviation`.
   *
   * Load-bearing on the opening utterance. `route` is stable there (measured
   * `new_task` at 1.00 across four phrasings) but `templateId` is NOT: the
   * same intent gave `choice_cards` 0.67, `focus_step` 0.49, `choice_cards`
   * 0.47 and `focus_step` 0.38. Half of those name a surface that cannot be
   * built from an empty task, and the projected composer correctly refuses
   * rather than inventing one — so the device painted nothing on the first
   * thing the user says. Reconciling here is the fix: the model classifies,
   * code decides what is constructible (CLAUDE.md constraint 2).
   */
  hasTask?: boolean;
  /**
   * `select` only, and only when the trigger was a physical touch/press
   * rather than voice (nothing upstream produces this yet — see the P2
   * report). Selection is deterministic from this, never from Jev's guess.
   */
  touchedSlot?: SlotId;
};

export type PolicyRule =
  | 'honour_jev'
  | 'refine_keep'
  | 'correct_recovery'
  | 'correct_keep'
  | 'select_mapped'
  | 'select_keep'
  | 'other_keep'
  | 'no_task_reprojected';

export type PolicyResult = { templateId: TemplateId; rule: PolicyRule };

/**
 * Deterministic, hand-picked, "no model" (per the brief) — the only entries
 * this table carries are ones the demo's own flow justifies: picking a
 * `choice_cards` option opens that thing, whole. Anything not in this table
 * keeps the current surface rather than guessing at a mapping nobody asked
 * for.
 */
const SELECT_TARGET: Partial<Record<TemplateId, TemplateId>> = {
  choice_cards: 'item_detail',
};

const templateOf = (slot: SlotId): TemplateId => slot.split('.')[0] as TemplateId;

/**
 * Surfaces that are a projection OF an open task, so they cannot be built
 * without one. `choice_cards`, `people_picker`, `message_drafts` and
 * `generic_answer` stand on their own.
 */
const TASK_REQUIRED: ReadonlySet<TemplateId> = new Set<TemplateId>([
  'item_detail',
  'focus_step',
  'recovery',
  'summary_done',
]);

function decide(input: PolicyInput): PolicyResult {
  const chosen = choose(input);
  // Reconcile against what the task state can actually produce. This is NOT a
  // fallback that hides a failure (constraint 5): nothing failed, and the rule
  // is reported so the turn log says exactly why the surface differs from what
  // Jev named.
  if (input.hasTask === false && TASK_REQUIRED.has(chosen.templateId)) {
    return { templateId: 'choice_cards', rule: 'no_task_reprojected' };
  }
  return chosen;
}

function choose(input: PolicyInput): PolicyResult {
  const { route, jevTemplateId, currentTemplate, hasDeviation, touchedSlot } = input;

  switch (route) {
    case 'new_task':
    case 'query':
      return { templateId: jevTemplateId, rule: 'honour_jev' };

    case 'refine':
      // Same task, different presentation — the surface never changes here.
      return currentTemplate
        ? { templateId: currentTemplate, rule: 'refine_keep' }
        : { templateId: jevTemplateId, rule: 'honour_jev' };

    case 'correct':
      if (hasDeviation) return { templateId: 'recovery', rule: 'correct_recovery' };
      return currentTemplate
        ? { templateId: currentTemplate, rule: 'correct_keep' }
        : { templateId: jevTemplateId, rule: 'honour_jev' };

    case 'select': {
      const mapped = touchedSlot ? SELECT_TARGET[templateOf(touchedSlot)] : undefined;
      if (mapped) return { templateId: mapped, rule: 'select_mapped' };
      return currentTemplate
        ? { templateId: currentTemplate, rule: 'select_keep' }
        : { templateId: jevTemplateId, rule: 'honour_jev' };
    }

    case 'other':
    default:
      return currentTemplate
        ? { templateId: currentTemplate, rule: 'other_keep' }
        : { templateId: jevTemplateId, rule: 'honour_jev' };
  }
}

export const policy: Node<PolicyInput, PolicyResult> = {
  name: 'policy',
  async run(input) {
    try {
      return decide(input);
    } catch {
      // Total: never let a policy bug take the whole turn down with it.
      return { templateId: input.currentTemplate ?? input.jevTemplateId, rule: 'other_keep' };
    }
  },
};
