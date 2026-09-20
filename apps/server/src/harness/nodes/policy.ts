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
  | 'other_keep';

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

function decide(input: PolicyInput): PolicyResult {
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
