import type { ContentUpdateV2, StructureUpdateV2 } from '@jit/schema';
import { applyDeviation, type TaskState } from '../../domain/recipe.js';
import { CHOICE_OPTIONS, CONTACTS, GROCERY_LIST_NAME, PANTRY_STOCKED, SPENDING_TRACKER_NAME } from '../../seed.js';
import { composeProjected, isProjectedSurface, type ProjectedInput, type SurfaceKind } from '../../compose/projected.js';
import { DEVIATION_FACTORS } from '../clients/jev-questions.js';
import type { Node } from '../types.js';

/**
 * Pure projection: `TaskState` -> a whole surface (`StructureUpdateV2` +
 * `ContentUpdateV2`). No model in the path — this is what makes the
 * structure-paint budget true for these surfaces, and it is the only reason a
 * judge can say "actually it was three times" and get correct numbers back
 * (CLAUDE.md constraint 2: the model classifies, code computes).
 *
 * The spec itself is built by `../../compose/projected.ts`; this node owns the
 * two things a composer must not: turning Jev's typed `correct`-route answer
 * into an effective `TaskState`, and staying **total** so a wrong number never
 * becomes an empty screen.
 *
 * Covers the seven surfaces that project from state — `item_detail`,
 * `focus_step`, `recovery`, `summary_done`, `choice_cards`, `people_picker`,
 * `grocery_added`.
 * `message_drafts`/`generic_answer` are generated, not projected, and come
 * back as a warning with no surface.
 */
export type ProjectInput = {
  state: TaskState;
  /**
   * Which surface to project. `SurfaceKind` rather than `TemplateId`: the
   * server owns one surface (`grocery_added`) that the frozen `TemplateId`
   * contract does not name. The two generated names inside `TemplateId` are
   * reported, not guessed at.
   */
  templateId: SurfaceKind;
  requestId: string;
  generationId: string;
  maxWidth?: number;
  /**
   * `recovery` only. The RAW ingredient id + factor choice Jev read off a
   * `correct` utterance (`../clients/jev-questions.ts`'s
   * `deviationIngredient`/`deviationFactor` — `factor` is one of
   * `DEVIATION_FACTORS`' keys, e.g. `'2x'`, not a number: the model
   * classifies, `project` computes). `state.inBowl` may not yet reflect the
   * mis-measurement — `project` applies it to a LOCAL copy purely to render
   * the recovery beat; it does not mutate or return an updated `TaskState`.
   * A caller that wants the correction to persist must call `applyDeviation`
   * itself and carry the result forward.
   */
  deviation?: { ingredientId: string; factor: string };
};

export type ProjectResult = {
  /** Absent when no surface could be produced — never a plausible empty one. */
  structure: StructureUpdateV2 | null;
  content: ContentUpdateV2 | null;
  /**
   * Non-fatal notices AND, when `structure` is null, the reason there is no
   * surface. Constraint 5: never hide a failure behind a silent fallback;
   * `project` stays total (never throws) by reporting instead.
   */
  warnings: string[];
};

const NO_SURFACE = (warnings: string[]): ProjectResult => ({ structure: null, content: null, warnings });

/**
 * Applies the model's typed `correct` answer to a local copy of the state.
 *
 * The model supplies a selection from a finite list and a factor *label*;
 * every number comes from `applyDeviation`.
 *
 * Exported because the orchestrator needs it twice and must get the same
 * answer both times: once to decide whether there IS a deviation (which is
 * what routes the turn to `recovery`), and once to persist the corrected
 * bowl into the session — a mis-measurement is a fact about the bowl, not a
 * proposal, and the `apply_fix` press that follows plans against it.
 */
export function applyJevDeviation(
  state: TaskState,
  deviation: { ingredientId: string; factor: string } | undefined,
  warnings: string[],
): TaskState {
  if (!deviation) return state;
  const factor = DEVIATION_FACTORS[deviation.factor];
  if (factor === undefined) {
    warnings.push(`recovery: unknown deviation factor "${deviation.factor}" — ignoring`);
    return state;
  }
  if (factor === null) {
    // "other" — the model classified that the fixed choices don't cover this
    // one; there is no number to compute with (constraint 2: the model never
    // supplies arithmetic), so the correction is skipped.
    warnings.push('recovery: deviation factor "other" has no number to compute with — ignoring');
    return state;
  }
  return applyDeviation(state, deviation.ingredientId, factor);
}

export const project: Node<ProjectInput, ProjectResult> = {
  name: 'project',
  async run(input) {
    const warnings: string[] = [];
    try {
      const { templateId } = input;
      if (!isProjectedSurface(templateId)) {
        return NO_SURFACE([`project: "${templateId}" is generated, not projected — no surface produced`]);
      }

      const state = templateId === 'recovery' ? applyJevDeviation(input.state, input.deviation, warnings) : input.state;
      const projected: ProjectedInput =
        templateId === 'choice_cards'
          ? { kind: 'choice_cards', options: CHOICE_OPTIONS }
          : templateId === 'people_picker'
            ? { kind: 'people_picker', contacts: CONTACTS }
            : templateId === 'grocery_added'
              ? {
                  kind: 'grocery_added',
                  state,
                  stocked: PANTRY_STOCKED,
                  listName: GROCERY_LIST_NAME,
                  trackerName: SPENDING_TRACKER_NAME,
                }
              : { kind: templateId, state };

      const result = composeProjected(projected, {
        requestId: input.requestId,
        generationId: input.generationId,
        ...(input.maxWidth !== undefined ? { maxWidth: input.maxWidth } : {}),
      });

      if (!result.ok) return NO_SURFACE([...warnings, ...result.warnings, `project: ${result.reason}`]);
      return { structure: result.structure, content: result.content, warnings: [...warnings, ...result.warnings] };
    } catch (err) {
      // Total: a throwing project() would turn a wrong number into an empty
      // screen. Report instead — the skeleton stays up and telemetry says why.
      return NO_SURFACE([...warnings, `project: unexpected error projecting "${input.templateId}": ${String(err)}`]);
    }
  },
};
