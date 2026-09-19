import { describe, expect, it } from 'vitest';
import {
  applyDeviation,
  applyScaleUp,
  completeStep,
  currentYield,
  estimateCost,
  findDeviations,
  planScaleUp,
  plannedAmount,
  setYield,
  type TaskState,
} from '../src/domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../src/domain/recipes.js';
import { formatAmount, formatQuantity, roundToKitchenFraction } from '../src/domain/quantity.js';

/**
 * The demo's strongest moment is arithmetic, and arithmetic on stage is checked
 * by whoever in the audience bakes. These tests are the reason that number is
 * computed here rather than generated.
 */

const fresh = (): TaskState => ({
  recipe: CLASSIC_CHOCOLATE_CHIP,
  scale: 1,
  stepIndex: 0,
  inBowl: {},
});

/** The state at the moment of the demo's recovery beat. */
const atStepThreeWithDoubleSugar = (): TaskState => {
  // 18 -> 30 cookies on the batch fader.
  let state = setYield(fresh(), 30);
  // Steps 1 and 2 go in as planned: butter, both sugars, eggs, vanilla.
  state = completeStep(state);
  state = completeStep(state);
  // "I accidentally added twice as much sugar."
  return applyDeviation(state, 'caster_sugar', 2);
};

describe('quantity formatting', () => {
  it('reads as a cook would write it', () => {
    expect(formatAmount(3.3333333)).toBe('3⅓');
    expect(formatAmount(0.5)).toBe('½');
    expect(formatAmount(1.25)).toBe('1¼');
    expect(formatAmount(2)).toBe('2');
    expect(formatAmount(1.6666666)).toBe('1⅔');
  });

  it('prefers the simplest denominator', () => {
    // 0.5 is expressible in eighths too; it must not render as 4/8.
    expect(formatAmount(0.5)).toBe('½');
    expect(formatAmount(0.75)).toBe('¾');
  });

  it('never leaks float noise onto the screen', () => {
    const noisy = 0.1 + 0.2; // 0.30000000000000004
    expect(formatAmount(noisy)).not.toContain('000');
    expect(formatQuantity({ amount: 2 / 3 + 2 / 3 + 2 / 3, unit: 'cup' })).toBe('2 cups');
  });

  it('pluralises, and drops the unit for countable things', () => {
    expect(formatQuantity({ amount: 1, unit: 'cup' })).toBe('1 cup');
    expect(formatQuantity({ amount: 2, unit: 'cup' })).toBe('2 cups');
    expect(formatQuantity({ amount: 3, unit: 'each' })).toBe('3');
    expect(formatQuantity({ amount: 250, unit: 'g' })).toBe('250g');
  });

  it('snaps an unmeasurable amount to the nearest one a cook can measure', () => {
    // There is no seventh-of-a-cup measure, so ⅛ is the honest answer — more
    // honest than 0.14, which implies a precision the kitchen does not have.
    expect(formatAmount(1 / 7)).toBe('\u215b');
    expect(formatAmount(0.31)).toBe('\u2153');
  });

  it('survives a nonsense amount without rendering nonsense', () => {
    expect(formatAmount(Number.NaN)).toBe('0');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('rounds to measurable amounts', () => {
    expect(roundToKitchenFraction(0.33)).toBeCloseTo(1 / 3, 5);
    expect(roundToKitchenFraction(0.51)).toBeCloseTo(0.5, 5);
  });
});

describe('scaling', () => {
  it('moves the yield the fader asks for', () => {
    const state = setYield(fresh(), 30);
    expect(currentYield(state)).toBe(30);
    // 2 cups of flour per 18 cookies -> 3⅓ for 30.
    expect(plannedAmount(state, 'flour')).toBeCloseTo(2 * (30 / 18), 6);
    expect(formatQuantity({ amount: plannedAmount(state, 'flour'), unit: 'cup' })).toBe(
      '3⅓ cups',
    );
  });

  it('costs what the itemised lines add up to', () => {
    const { total, lines } = estimateCost(setYield(fresh(), 30));
    const summed = Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100) / 100;
    expect(total).toBe(summed);
    expect(total).toBeGreaterThan(0);
  });
});

describe('completing steps', () => {
  it('puts exactly the planned amounts in the bowl', () => {
    const state = completeStep(setYield(fresh(), 18));
    expect(state.inBowl['butter']).toBeCloseTo(1, 6);
    expect(state.inBowl['caster_sugar']).toBeCloseTo(0.75, 6);
    // Not added yet.
    expect(state.inBowl['flour']).toBeUndefined();
    expect(state.stepIndex).toBe(1);
  });

  it('stops at the end rather than running off it', () => {
    let state = fresh();
    for (let i = 0; i < 20; i += 1) state = completeStep(state);
    expect(state.stepIndex).toBe(CLASSIC_CHOCOLATE_CHIP.steps.length);
  });
});

describe('the recovery beat — twice the sugar at step 3', () => {
  it('notices only the ingredient that actually deviated', () => {
    const deviations = findDeviations(atStepThreeWithDoubleSugar());
    expect(deviations).toHaveLength(1);
    expect(deviations[0]).toMatchObject({ id: 'caster_sugar', factor: 2 });
  });

  it('doubles the batch, because the worst over-addition sets the new scale', () => {
    const plan = planScaleUp(atStepThreeWithDoubleSugar());
    expect(plan.previousYield).toBe(30);
    expect(plan.newYield).toBe(60);
  });

  it('tops up what is already in the bowl by exactly one more batch-worth', () => {
    const state = atStepThreeWithDoubleSugar();
    const plan = planScaleUp(state);
    const topup = (id: string) => plan.topups.find((t) => t.id === id)?.add.amount;

    // Butter went in at 30-cookie scale (1 cup x 30/18). Doubling the recipe
    // means it needs that much again.
    expect(topup('butter')).toBeCloseTo(roundToKitchenFraction(1 * (30 / 18)), 6);
    // Eggs are countable: 3 in the bowl, 7 needed, so 4 more.
    expect(topup('eggs')).toBe(4);

    // Sugar is ALREADY at the doubled amount — it is what forced the rescale,
    // so it must not be topped up at all.
    expect(topup('caster_sugar')).toBeUndefined();
  });

  it('never asks anyone to add a third of an egg', () => {
    // 2 eggs per 18 cookies scaled to 60 is 6.67. Countable ingredients must
    // land on whole numbers everywhere they surface: in the bowl, in the
    // top-up, and in the rendered string.
    const state = atStepThreeWithDoubleSugar();
    const plan = planScaleUp(state);
    const eggs = plan.topups.find((t) => t.id === 'eggs');

    expect(eggs?.add.amount).toBe(Math.round(eggs!.add.amount));
    expect(formatQuantity(eggs!.add)).toBe('4');
    expect(applyScaleUp(state, plan).inBowl['eggs']).toBe(7);

    for (const entry of [...plan.topups, ...plan.remaining]) {
      if (entry.add.unit !== 'each') continue;
      expect(formatQuantity(entry.add), entry.name).toMatch(/^\d+$/);
    }
  });

  it('lists not-yet-added ingredients separately, at the new scale', () => {
    const plan = planScaleUp(atStepThreeWithDoubleSugar());
    const flour = plan.remaining.find((r) => r.id === 'flour');
    const chips = plan.remaining.find((r) => r.id === 'choc_chips');

    expect(plan.topups.map((t) => t.id)).not.toContain('flour');
    expect(flour?.add.amount).toBeCloseTo(roundToKitchenFraction(2 * (60 / 18)), 6);
    expect(chips?.add.amount).toBeCloseTo(roundToKitchenFraction(1.25 * (60 / 18)), 6);
  });

  it('leaves the bowl consistent with the new plan once applied', () => {
    const state = atStepThreeWithDoubleSugar();
    const after = applyScaleUp(state, planScaleUp(state));

    expect(currentYield(after)).toBe(60);
    // Everything that was in the bowl is now at its planned amount, so nothing
    // still reads as a deviation.
    expect(findDeviations(after)).toEqual([]);
  });

  it('is idempotent — confirming twice does not double the batch again', () => {
    const state = atStepThreeWithDoubleSugar();
    const once = applyScaleUp(state, planScaleUp(state));
    const twice = applyScaleUp(once, planScaleUp(once));
    expect(currentYield(twice)).toBe(60);
  });
});

describe('the judge follow-up', () => {
  it('handles "actually it was three times" without a re-prompt', () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    state = applyDeviation(state, 'caster_sugar', 3);

    const plan = planScaleUp(state);
    expect(plan.newYield).toBe(90);
    expect(plan.topups.find((t) => t.id === 'caster_sugar')).toBeUndefined();
    expect(findDeviations(applyScaleUp(state, plan))).toEqual([]);
  });

  it('handles a deviation in something other than sugar', () => {
    let state = setYield(fresh(), 18);
    state = completeStep(state);
    state = applyDeviation(state, 'butter', 1.5);

    const plan = planScaleUp(state);
    expect(plan.newYield).toBe(27);
    expect(plan.topups.find((t) => t.id === 'brown_sugar')?.add.amount).toBeCloseTo(
      roundToKitchenFraction(0.75 * 1.5 - 0.75),
      6,
    );
  });

  it('does nothing when nothing deviated', () => {
    const state = completeStep(setYield(fresh(), 18));
    const plan = planScaleUp(state);
    expect(plan.newYield).toBe(18);
    expect(plan.topups).toEqual([]);
  });

  it('ignores an ingredient that is not in this recipe', () => {
    const state = applyDeviation(setYield(fresh(), 18), 'saffron', 2);
    expect(findDeviations(state)).toEqual([]);
  });
});
