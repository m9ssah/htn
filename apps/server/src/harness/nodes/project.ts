import type { ContentPatch, SlotValue, TemplateId } from '@jit/schema';
import {
  applyDeviation,
  currentYield,
  describeDeviation,
  describeQuantity,
  estimateCost,
  findDeviations,
  ingredientById,
  plannedAmount,
  planScaleUp,
  type Ingredient,
  type TaskState,
} from '../../domain/recipe.js';
import { CHOICE_OPTIONS, CONTACTS } from '../../seed.js';
import { DEVIATION_FACTORS } from '../clients/jev-questions.js';
import type { Node } from '../types.js';

/**
 * Pure projection: `TaskState` -> `ContentPatch`. No model in the path — this
 * is what makes CLAUDE.md constraint 3 (content under 1.5s) true for these
 * surfaces, and it is the only reason a judge can say "actually it was three
 * times" and get correct numbers back (constraint 2: the model classifies,
 * code computes).
 *
 * Covers the six templates that project from `TaskState`:
 * `item_detail`, `focus_step`, `recovery`, `summary_done`, `choice_cards`,
 * `people_picker`. `message_drafts`/`generic_answer` are generated, not
 * projected — not this node's job (they produce an empty patch + a warning).
 */
export type ProjectInput = {
  state: TaskState;
  templateId: TemplateId;
  /**
   * `recovery` only. The RAW ingredient id + factor choice Jev read off a
   * `correct` utterance (`jev-questions.ts`'s
   * `deviationIngredient`/`deviationFactor` — `factor` is one of
   * `DEVIATION_FACTORS`' keys, e.g. `'2x'`, not a number: the model
   * classifies, `project` computes). `state.inBowl` may not yet reflect the
   * mis-measurement — `project` applies it to a LOCAL copy purely to render
   * the recovery beat; it does not mutate or return an updated `TaskState`.
   * A caller that wants the correction to persist into later turns must call
   * `applyDeviation` itself and carry the result forward — that state-owning
   * role belongs to whatever wires the graph together (P4), not to a pure
   * projection node.
   */
  deviation?: { ingredientId: string; factor: string };
};

export type ProjectResult = {
  patch: ContentPatch;
  /**
   * Non-fatal notices — an overflowed slot, a recovery template asked for
   * with nothing to show. Constraint 5: never hide a failure behind a silent
   * fallback; `project` stays total (never throws) by reporting instead.
   */
  warnings: string[];
};

type ListItemValue = Extract<SlotValue, { kind: 'ListItem' }>;

const MAX_ITEM_DETAIL_LINES = 8;
const MAX_FOCUS_STEP_DETAILS = 3;

function ingredientRow(state: TaskState, ingredient: Ingredient, costById: Map<string, number>): ListItemValue {
  const qty = describeQuantity({ amount: plannedAmount(state, ingredient.id), unit: ingredient.unit });
  const cost = costById.get(ingredient.id);
  return {
    kind: 'ListItem',
    title: `${qty} ${ingredient.name}`,
    ...(cost !== undefined ? { meta: `$${cost.toFixed(2)}` } : {}),
  };
}

function projectItemDetail(state: TaskState): { slots: ContentPatch['slots']; warnings: string[] } {
  const warnings: string[] = [];
  const { recipe } = state;
  const costById = new Map(estimateCost(state).lines.map((line) => [line.id, line.cost]));

  const rows = recipe.ingredients.map((ingredient) => ingredientRow(state, ingredient, costById));
  const overflow = recipe.ingredients.slice(MAX_ITEM_DETAIL_LINES);
  if (overflow.length > 0) {
    const lastIndex = MAX_ITEM_DETAIL_LINES - 1;
    const last = rows[lastIndex];
    if (last) {
      rows[lastIndex] = { ...last, title: `${last.title} · +${overflow.map((i) => i.name).join(', ')}` };
    }
    warnings.push(
      `item_detail: ${overflow.length} ingredient(s) overflowed the ${MAX_ITEM_DETAIL_LINES} reserved rows, ` +
        `folded into row ${MAX_ITEM_DETAIL_LINES}: ${overflow.map((i) => i.name).join(', ')}`,
    );
  }

  return {
    warnings,
    slots: {
      'item_detail.title': { kind: 'Heading', text: recipe.name },
      'item_detail.subtitle': {
        kind: 'Text',
        text: `${currentYield(state)} ${recipe.yieldUnit} · ${recipe.minutes} min`,
      },
      'item_detail.axis': {
        kind: 'Slider',
        label: 'Batch size',
        min: recipe.baseYield,
        max: recipe.baseYield * 3,
        step: Math.max(1, Math.round(recipe.baseYield / 3)),
        value: currentYield(state),
        unit: recipe.yieldUnit,
      },
      'item_detail.linesLabel': { kind: 'Label', text: 'Ingredients' },
      'item_detail.line1': rows[0] ?? null,
      'item_detail.line2': rows[1] ?? null,
      'item_detail.line3': rows[2] ?? null,
      'item_detail.line4': rows[3] ?? null,
      'item_detail.line5': rows[4] ?? null,
      'item_detail.line6': rows[5] ?? null,
      'item_detail.line7': rows[6] ?? null,
      'item_detail.line8': rows[7] ?? null,
      'item_detail.primary': { kind: 'Button', text: 'Start cooking' },
    },
  };
}

function projectFocusStep(state: TaskState): { slots: ContentPatch['slots']; warnings: string[] } {
  const warnings: string[] = [];
  const { recipe, stepIndex } = state;
  const step = recipe.steps[stepIndex];
  const isLast = stepIndex >= recipe.steps.length - 1;

  if (!step) warnings.push(`focus_step: stepIndex ${stepIndex} is past the last step (${recipe.steps.length})`);

  const details = (step?.adds ?? []).slice(0, MAX_FOCUS_STEP_DETAILS).map(
    (id): ListItemValue => {
      const ingredient = ingredientById(recipe, id);
      const name = ingredient?.name ?? id;
      const qty = ingredient ? describeQuantity({ amount: plannedAmount(state, id), unit: ingredient.unit }) : '';
      return { kind: 'ListItem', title: qty ? `${qty} ${name}` : name };
    },
  );

  return {
    warnings,
    slots: {
      'focus_step.progress': { kind: 'Label', text: `Step ${Math.min(stepIndex + 1, recipe.steps.length)} of ${recipe.steps.length}` },
      'focus_step.instruction': { kind: 'Heading', text: step?.instruction ?? 'All steps complete' },
      'focus_step.detail1': details[0] ?? null,
      'focus_step.detail2': details[1] ?? null,
      'focus_step.detail3': details[2] ?? null,
      'focus_step.prev': stepIndex > 0 ? { kind: 'Button', text: 'Back' } : null,
      'focus_step.next': !isLast && step ? { kind: 'Button', text: 'Next' } : null,
      'focus_step.done': isLast && step ? { kind: 'Button', text: 'Done' } : null,
    },
  };
}

function projectRecovery(
  state: TaskState,
  deviationInput: { ingredientId: string; factor: string } | undefined,
): { slots: ContentPatch['slots']; warnings: string[] } {
  const warnings: string[] = [];
  let effective = state;

  if (deviationInput) {
    const factor = DEVIATION_FACTORS[deviationInput.factor];
    if (factor === undefined) {
      warnings.push(`recovery: unknown deviation factor "${deviationInput.factor}" — ignoring`);
    } else if (factor === null) {
      // "other" — the model classified that the fixed choices don't cover
      // this one; there is no number to compute with (constraint 2: the
      // model never supplies arithmetic), so the correction is skipped.
      warnings.push('recovery: deviation factor "other" has no number to compute with — ignoring');
    } else {
      effective = applyDeviation(state, deviationInput.ingredientId, factor);
    }
  }

  const deviations = findDeviations(effective);
  const worst = deviations[0];
  const plan = planScaleUp(effective);
  const scalingUp = plan.newYield > plan.previousYield;

  if (!worst) {
    warnings.push('recovery: no deviation found in the given TaskState — showing a neutral recovery surface');
  }

  const topupText =
    plan.topups.length > 0
      ? plan.topups.map((t) => `${describeQuantity(t.add)} more ${t.name.toLowerCase()}`).join(', ')
      : null;

  const planText = scalingUp
    ? topupText
      ? `Scale the whole batch to ${plan.newYield} ${effective.recipe.yieldUnit} — add ${topupText} to catch up.`
      : `Scale the whole batch to ${plan.newYield} ${effective.recipe.yieldUnit} to match.`
    : 'Nothing left to scale up to — starting over is the only fix that undoes what already went in.';

  return {
    warnings,
    slots: {
      'recovery.kind': { kind: 'Label', text: 'Correction' },
      'recovery.title': { kind: 'Heading', text: worst ? `${worst.name} looks off` : 'Nothing to correct' },
      'recovery.diagnosis': {
        kind: 'Alert',
        text: worst ? describeDeviation(worst) : 'Everything in the bowl matches the plan so far.',
      },
      'recovery.planLabel': { kind: 'Label', text: 'Recommended fix' },
      'recovery.plan': { kind: 'Text', text: planText },
      'recovery.outcome': {
        kind: 'Metric',
        label: `New ${effective.recipe.yieldUnit}`,
        value: `${plan.newYield}`,
        ...(scalingUp ? { delta: `+${plan.newYield - plan.previousYield}` } : {}),
      },
      'recovery.secondary': { kind: 'Button', text: 'Start over' },
      // `apply_fix` genuinely does not apply when nothing can be scaled up to
      // (an under-addition) — collapsed per ContentPatch's "not applicable to
      // this instance" null, not left to shimmer forever or duplicate the
      // "Start over" button.
      'recovery.primary': scalingUp ? { kind: 'Button', text: `Scale up to ${plan.newYield}` } : null,
    },
  };
}

function projectSummaryDone(state: TaskState): { slots: ContentPatch['slots']; warnings: string[] } {
  return {
    warnings: [],
    slots: {
      'summary_done.title': { kind: 'Heading', text: `${state.recipe.name} is ready` },
      'summary_done.result': { kind: 'Metric', label: 'Yield', value: `${currentYield(state)} ${state.recipe.yieldUnit}` },
      'summary_done.prompt': { kind: 'Text', text: 'What would you like to do next?' },
    },
  };
}

function projectChoiceCards(): { slots: ContentPatch['slots']; warnings: string[] } {
  const warnings: string[] = [];
  const options = CHOICE_OPTIONS.map(
    (option): ListItemValue => ({
      kind: 'ListItem',
      title: option.title,
      detail: option.blurb,
      meta: `${option.minutes} min`,
    }),
  );
  if (options.length < 3) warnings.push(`choice_cards: only ${options.length} seeded option(s), expected 3`);

  const effort = CHOICE_OPTIONS[Math.floor(CHOICE_OPTIONS.length / 2)]?.effort ?? 1;

  return {
    warnings,
    slots: {
      'choice_cards.title': { kind: 'Heading', text: 'What do you want to make?' },
      'choice_cards.subtitle': { kind: 'Text', text: 'Pick one to get started' },
      'choice_cards.axis': {
        kind: 'Slider',
        label: 'Effort',
        min: 0,
        max: 2,
        step: 1,
        value: effort,
        minLabel: 'Quick',
        maxLabel: 'Impressive',
      },
      'choice_cards.option1': options[0] ?? null,
      'choice_cards.option2': options[1] ?? null,
      'choice_cards.option3': options[2] ?? null,
    },
  };
}

function projectPeoplePicker(): { slots: ContentPatch['slots']; warnings: string[] } {
  const warnings: string[] = [];
  const people = CONTACTS.map((contact): ListItemValue => ({ kind: 'ListItem', title: contact.name }));
  if (people.length < 3) warnings.push(`people_picker: only ${people.length} seeded contact(s), expected 3`);

  return {
    warnings,
    slots: {
      'people_picker.title': { kind: 'Heading', text: "Who's getting a text?" },
      'people_picker.subtitle': { kind: 'Text', text: 'Pick up to 3' },
      'people_picker.person1': people[0] ?? null,
      'people_picker.person2': people[1] ?? null,
      'people_picker.person3': people[2] ?? null,
      'people_picker.confirm': { kind: 'Button', text: 'Send messages' },
    },
  };
}

export const project: Node<ProjectInput, ProjectResult> = {
  name: 'project',
  async run({ state, templateId, deviation }) {
    try {
      switch (templateId) {
        case 'item_detail': {
          const { slots, warnings } = projectItemDetail(state);
          return { patch: { v: 1, slots }, warnings };
        }
        case 'focus_step': {
          const { slots, warnings } = projectFocusStep(state);
          return { patch: { v: 1, slots }, warnings };
        }
        case 'recovery': {
          const { slots, warnings } = projectRecovery(state, deviation);
          return { patch: { v: 1, slots }, warnings };
        }
        case 'summary_done': {
          const { slots, warnings } = projectSummaryDone(state);
          return { patch: { v: 1, slots }, warnings };
        }
        case 'choice_cards': {
          const { slots, warnings } = projectChoiceCards();
          return { patch: { v: 1, slots }, warnings };
        }
        case 'people_picker': {
          const { slots, warnings } = projectPeoplePicker();
          return { patch: { v: 1, slots }, warnings };
        }
        case 'message_drafts':
        case 'generic_answer':
          return {
            patch: { v: 1, slots: {} },
            warnings: [`project: "${templateId}" is generated, not projected — no slots produced`],
          };
      }
    } catch (err) {
      // Total: a throwing project() would turn a wrong number into an empty
      // screen. Report instead — the skeleton stays up and telemetry says why.
      return { patch: { v: 1, slots: {} }, warnings: [`project: unexpected error projecting "${templateId}": ${String(err)}`] };
    }
  },
};
