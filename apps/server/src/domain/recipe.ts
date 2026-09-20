import { formatQuantity, roundForUnit, type Quantity, type Unit } from './quantity.js';

/**
 * The typed task state.
 *
 * Constraint 2: the model decides, code computes. Everything in this file is a
 * pure function over a typed model, and nothing here is ever produced by a
 * language model. The model's job is to say *what happened* ("sugar, about
 * twice") and *which strategy* ("scale up"); the numbers on screen come from
 * here.
 *
 * That is also what makes the judge handoff survivable: "actually it was three
 * times" is a different argument to the same function, not a re-prompt and a
 * hope.
 */

export type Ingredient = {
  id: string;
  name: string;
  /** Amount for ONE batch, i.e. at `baseYield`. Scaling multiplies this. */
  amount: number;
  unit: Unit;
  /** Cost of one `unit`, in dollars. Stubbed table — a demo account, and we say so. */
  pricePerUnit: number;
};

export type Step = {
  id: string;
  instruction: string;
  /** Ingredient IDs this step puts in the bowl. */
  adds: string[];
  /**
   * How long this step takes unattended, if it is a wait rather than a doing.
   * Absent on steps you finish when you finish — `focus_step` shows a timer
   * only where there is a real duration to count, never an invented one.
   */
  seconds?: number;
};

export type Recipe = {
  id: string;
  name: string;
  /** How many `yieldUnit` one unscaled batch makes. */
  baseYield: number;
  yieldUnit: string;
  minutes: number;
  ingredients: Ingredient[];
  steps: Step[];
};

export type TaskState = {
  recipe: Recipe;
  /** Multiplier on the whole recipe. 1 = one base batch. */
  scale: number;
  /** Index into `recipe.steps`. */
  stepIndex: number;
  /**
   * What is ACTUALLY in the bowl, by ingredient ID, in the ingredient's own
   * unit. Diverges from the plan the moment someone mis-measures — which is the
   * entire point of tracking it separately.
   */
  inBowl: Record<string, number>;
  /**
   * Wall-clock ms when the current step was entered — the origin any timer on
   * that step counts from.
   *
   * It has to live here rather than be stamped at paint time: a surface
   * repaints on every utterance, and a timer whose start is "now" restarts on
   * each repaint and therefore never advances. Absent means the step was
   * never formally entered, and the surface falls back to painting the full
   * duration rather than a wrong elapsed.
   */
  stepStartedAt?: number;
};

/* ------------------------------------------------------------------ *
 * Reading the plan
 * ------------------------------------------------------------------ */

export const ingredientById = (recipe: Recipe, id: string): Ingredient | undefined =>
  recipe.ingredients.find((i) => i.id === id);

/**
 * What the plan calls for at the current scale, rounded to something the unit
 * can express. Rounding HERE rather than at display time keeps the bowl and the
 * plan in the same numbers — otherwise a rounded display and an unrounded model
 * disagree, and the top-up arithmetic drifts.
 */
export function plannedAmount(state: TaskState, id: string): number {
  const ingredient = ingredientById(state.recipe, id);
  if (ingredient === undefined) return 0;
  return roundForUnit(ingredient.amount * state.scale, ingredient.unit);
}

export const currentYield = (state: TaskState): number =>
  Math.round(state.recipe.baseYield * state.scale);

/** Ingredient list at the current scale, ready for slots. */
export function scaledIngredients(state: TaskState): { ingredient: Ingredient; qty: Quantity }[] {
  return state.recipe.ingredients.map((ingredient) => ({
    ingredient,
    qty: { amount: ingredient.amount * state.scale, unit: ingredient.unit },
  }));
}

/**
 * Cost at the current scale.
 *
 * Rounded per ingredient before summing, because that is what the itemised list
 * shows — summing unrounded values would make the total disagree with the rows
 * above it, which is exactly the kind of detail a judge notices.
 */
export function estimateCost(state: TaskState): { total: number; lines: { id: string; cost: number }[] } {
  const lines = state.recipe.ingredients.map((ingredient) => ({
    id: ingredient.id,
    cost: Math.round(ingredient.amount * state.scale * ingredient.pricePerUnit * 100) / 100,
  }));
  const total = Math.round(lines.reduce((sum, l) => sum + l.cost, 0) * 100) / 100;
  return { total, lines };
}

/* ------------------------------------------------------------------ *
 * Changing the plan
 * ------------------------------------------------------------------ */

/**
 * Rescale to a target yield — what the batch-size fader does.
 *
 * Only rescales what has NOT been added yet. Rescaling past what is already in
 * the bowl would silently produce a recipe nobody can actually follow.
 */
export function setYield(state: TaskState, targetYield: number): TaskState {
  const scale = Math.max(targetYield, 1) / state.recipe.baseYield;
  return { ...state, scale };
}

/** Advance a step, putting that step's ingredients in the bowl as planned. */
export function completeStep(state: TaskState): TaskState {
  const step = state.recipe.steps[state.stepIndex];
  if (step === undefined) return state;

  const inBowl = { ...state.inBowl };
  for (const id of step.adds) {
    inBowl[id] = (inBowl[id] ?? 0) + plannedAmount(state, id);
  }
  return {
    ...state,
    inBowl,
    stepIndex: Math.min(state.stepIndex + 1, state.recipe.steps.length),
  };
}

/**
 * Record a mis-measurement: `factor` times the intended amount went in.
 *
 * The model supplies `id` (a selection from THIS recipe's ingredients, so a
 * finite list) and `factor` (a number it read off the utterance). It supplies
 * nothing else — no new quantities, no new yield.
 */
export function applyDeviation(state: TaskState, id: string, factor: number): TaskState {
  const planned = plannedAmount(state, id);
  if (planned === 0) return state;
  return { ...state, inBowl: { ...state.inBowl, [id]: planned * factor } };
}

/* ------------------------------------------------------------------ *
 * Recovery
 * ------------------------------------------------------------------ */

export type Deviation = {
  id: string;
  name: string;
  planned: Quantity;
  actual: Quantity;
  /** actual / planned. 2 means twice as much went in. */
  factor: number;
};

/** Every ingredient in the bowl that is not at its planned amount. */
export function findDeviations(state: TaskState, tolerance = 0.02): Deviation[] {
  const out: Deviation[] = [];
  for (const [id, actual] of Object.entries(state.inBowl)) {
    const ingredient = ingredientById(state.recipe, id);
    if (ingredient === undefined) continue;
    const planned = plannedAmount(state, id);
    if (planned === 0) continue;
    const factor = actual / planned;
    if (Math.abs(factor - 1) <= tolerance) continue;
    out.push({
      id,
      name: ingredient.name,
      planned: { amount: planned, unit: ingredient.unit },
      actual: { amount: actual, unit: ingredient.unit },
      factor,
    });
  }
  // Worst first, so the surface leads with the thing that actually went wrong.
  return out.sort((a, b) => Math.abs(b.factor - 1) - Math.abs(a.factor - 1));
}

export type Topup = { id: string; name: string; add: Quantity };

export type ScaleUpPlan = {
  strategy: 'scale_up';
  /** The scale the whole recipe moves to. */
  newScale: number;
  newYield: number;
  previousYield: number;
  /** Ingredients already in the bowl that need more, to catch up. */
  topups: Topup[];
  /** Ingredients not yet added, at the new scale — their steps will cover these. */
  remaining: Topup[];
};

export type StartOverPlan = { strategy: 'start_over'; discardedYield: number };

export type RecoveryPlan = ScaleUpPlan | StartOverPlan;

/**
 * Scale the recipe up to match whatever went in the bowl.
 *
 * The new scale is driven by the WORST over-addition: if twice the sugar went
 * in, everything else has to double to match it, and the batch doubles with it.
 * Under-additions cannot be fixed by scaling up — you cannot un-add flour — so
 * they are ignored here and left to `start_over`.
 */
export function planScaleUp(state: TaskState): ScaleUpPlan {
  const deviations = findDeviations(state);
  const worst = Math.max(1, ...deviations.map((d) => d.factor));
  const newScale = state.scale * worst;

  const topups: Topup[] = [];
  const remaining: Topup[] = [];

  for (const ingredient of state.recipe.ingredients) {
    const required = roundForUnit(ingredient.amount * newScale, ingredient.unit);
    const actual = state.inBowl[ingredient.id] ?? 0;
    const shortfall = roundForUnit(required - actual, ingredient.unit);
    if (shortfall <= 0) continue;

    const entry: Topup = {
      id: ingredient.id,
      name: ingredient.name,
      add: { amount: shortfall, unit: ingredient.unit },
    };
    if (actual > 0) topups.push(entry);
    else remaining.push(entry);
  }

  return {
    strategy: 'scale_up',
    newScale,
    newYield: Math.round(state.recipe.baseYield * newScale),
    previousYield: currentYield(state),
    topups,
    remaining,
  };
}

/** Commit a recovery plan. The only place `scale` changes after baking starts. */
export function applyScaleUp(state: TaskState, plan: ScaleUpPlan): TaskState {
  const inBowl = { ...state.inBowl };
  for (const topup of plan.topups) {
    inBowl[topup.id] = (inBowl[topup.id] ?? 0) + topup.add.amount;
  }
  return { ...state, scale: plan.newScale, inBowl };
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 *
 * These produce strings for slots. They live here, next to the numbers, so
 * there is exactly one place a quantity becomes text.
 * ------------------------------------------------------------------ */

export const describeQuantity = formatQuantity;

export function describeDeviation(deviation: Deviation): string {
  const times = Math.round(deviation.factor * 100) / 100;
  return (
    `You added about ${formatQuantity(deviation.actual)} of ${deviation.name.toLowerCase()} ` +
    `instead of ${formatQuantity(deviation.planned)} — roughly ${times}×.`
  );
}
