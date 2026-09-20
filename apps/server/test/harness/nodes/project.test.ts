import { describe, expect, it } from 'vitest';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { project, type ProjectInput } from '../../../src/harness/nodes/project.js';
import { applyDeviation, completeStep, setYield, type TaskState } from '../../../src/domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../../../src/domain/recipes.js';
import { CHOICE_OPTIONS, CONTACTS } from '../../../src/seed.js';

const ctx = createStubCtx(new AbortController().signal);

const fresh = (): TaskState => ({ recipe: CLASSIC_CHOCOLATE_CHIP, scale: 1, stepIndex: 0, inBowl: {} });

const run = (input: Omit<ProjectInput, 'requestId' | 'generationId'>) =>
  project.run({ requestId: 'req-1', generationId: 'gen-1', ...input }, ctx);

/** The content a given element received, or `undefined` if it is not on the surface. */
const copy = (
  result: Awaited<ReturnType<typeof run>>,
  elementId: string,
): Record<string, unknown> | undefined => result.content?.values[elementId];

describe('project — item_detail', () => {
  it('fills title/subtitle/batch and gives all nine seeded ingredients their own row', async () => {
    const result = await run({ state: fresh(), templateId: 'item_detail' });

    expect(copy(result, 'title')).toEqual({ text: 'Classic Chocolate Chip' });
    expect(result.structure?.spec.elements.batch?.props).toMatchObject({ unit: 'cookies', value: 18 });

    // The demo recipe must never be the overflow case: every ingredient gets
    // a row of its own, with the quantity the domain computed.
    expect(Object.keys(result.structure!.spec.elements).filter((k) => k.startsWith('ing_'))).toHaveLength(
      CLASSIC_CHOCOLATE_CHIP.ingredients.length,
    );
    expect(copy(result, 'ing_8')).toEqual({ title: 'Salt', detail: '$0.01', meta: '\u00bd tsp' });
    expect(result.warnings.filter((w) => !w.includes('below the fold'))).toEqual([]);
  });

  it('never leaves a bound element without content — a one-shot surface has nothing pending', async () => {
    const result = await run({ state: fresh(), templateId: 'item_detail' });

    const bound = Object.entries(result.structure!.spec.elements)
      .filter(([, element]) => 'pending' in element.props)
      .map(([key]) => key);
    expect(bound.length).toBeGreaterThan(0);
    for (const key of bound) expect(result.content?.values[key]).toBeDefined();
  });

  it('is total: an empty-ingredient recipe produces a surface with no rows and a warning', async () => {
    const empty: TaskState = { recipe: { ...CLASSIC_CHOCOLATE_CHIP, ingredients: [] }, scale: 1, stepIndex: 0, inBowl: {} };

    const result = await run({ state: empty, templateId: 'item_detail' });

    expect(result.structure).not.toBeNull();
    expect(Object.keys(result.structure!.spec.elements).filter((k) => k.startsWith('ing_'))).toEqual([]);
    expect(result.warnings.some((w) => w.includes('no ingredients'))).toBe(true);
  });
});

describe('project — focus_step', () => {
  it('shows the current step and hides prev on the first step', async () => {
    const result = await run({ state: fresh(), templateId: 'focus_step' });

    expect(copy(result, 'instruction')).toEqual({ text: 'Cream the butter and sugars' });
    expect(result.structure?.spec.elements.prev).toBeUndefined();
    expect(copy(result, 'next')).toEqual({ text: 'Next' });
  });

  it('shows done instead of next on the last step, and prev once past the first', async () => {
    const state: TaskState = { ...fresh(), stepIndex: CLASSIC_CHOCOLATE_CHIP.steps.length - 1 };

    const result = await run({ state, templateId: 'focus_step' });

    expect(result.structure?.spec.elements.prev).toBeDefined();
    expect(copy(result, 'next')).toEqual({ text: 'Done' });
    expect(result.structure?.spec.elements.next?.on?.press?.action).toBe('step_done');
  });

  it('is total: a stepIndex past the end does not throw', async () => {
    const state: TaskState = { ...fresh(), stepIndex: 999 };

    const result = await run({ state, templateId: 'focus_step' });

    expect(copy(result, 'instruction')).toEqual({ text: 'All steps complete' });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reports what is actually in the bowl, not what was planned', async () => {
    const result = await run({ state: completeStep(fresh()), templateId: 'focus_step' });

    const bowl = String(copy(result, 'bowl')?.text);
    expect(bowl).toContain('1 cup butter');
    expect(bowl).toContain('¾ cups caster sugar');
  });
});

describe('project — recovery', () => {
  it('diagnoses the worst deviation already in the TaskState and recommends scaling up', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    state = applyDeviation(state, 'caster_sugar', 2); // over-addition — scalable

    const result = await run({ state, templateId: 'recovery' });

    expect(copy(result, 'title')).toEqual({ text: 'Caster sugar looks off' });
    expect(copy(result, 'fix')).toEqual({ text: 'Scale up to 60' });
    expect(copy(result, 'outcome')).toEqual({ label: 'New cookies', value: '60', delta: 'you planned for 30' });
    // The topup text is what makes this the recovery beat's actual content —
    // ingredients already caught up to the new scale (caster_sugar, the
    // deviation itself) must not appear; ones that still need more must.
    const planText = String(copy(result, 'plan')?.text);
    expect(planText).toContain('Scale the whole batch to 60 cookies');
    expect(planText).toContain('more butter');
    expect(planText).not.toContain('caster sugar');
    expect(result.warnings.filter((w) => !w.includes('below the fold'))).toEqual([]);
  });

  it('applies a Jev-supplied ingredient+factor choice locally when the TaskState has not been corrected yet', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    // NOT applying the deviation to `state` itself — project must derive it.

    const result = await run({
      state,
      templateId: 'recovery',
      deviation: { ingredientId: 'caster_sugar', factor: '2x' },
    });

    expect(copy(result, 'title')).toEqual({ text: 'Caster sugar looks off' });
  });

  it('an under-addition cannot be scaled away — drops the fix button rather than duplicating "Start over"', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    state = applyDeviation(state, 'caster_sugar', 0.5); // under-addition

    const result = await run({ state, templateId: 'recovery' });

    expect(result.structure?.spec.elements.fix).toBeUndefined();
    expect(copy(result, 'restart')).toEqual({ text: 'Start over' });
  });

  it('a deviation factor of "other" cannot be computed and is skipped with a warning, not a throw', async () => {
    const result = await run({
      state: fresh(),
      templateId: 'recovery',
      deviation: { ingredientId: 'caster_sugar', factor: 'other' },
    });

    expect(copy(result, 'title')).toEqual({ text: 'Nothing to correct' });
    expect(result.warnings.some((w) => w.includes('other'))).toBe(true);
  });

  it('is total: no deviation anywhere still renders a neutral surface with a warning, not a throw', async () => {
    const result = await run({ state: fresh(), templateId: 'recovery' });

    expect(copy(result, 'title')).toEqual({ text: 'Nothing to correct' });
    expect(result.warnings.some((w) => w.includes('deviates'))).toBe(true);
  });
});

describe('project — summary_done / choice_cards / people_picker', () => {
  it('summary_done reports the current yield and what it cost', async () => {
    const result = await run({ state: setYield(fresh(), 36), templateId: 'summary_done' });

    expect(copy(result, 'result')).toEqual({ label: 'Made', value: '36 cookies' });
    expect(copy(result, 'spend')).toEqual({ label: 'Ingredients', value: '$10.98', delta: '9 items' });
  });

  it('choice_cards projects the 3 seeded demo options — clearly seed data, not derived', async () => {
    const result = await run({ state: fresh(), templateId: 'choice_cards' });

    expect(CHOICE_OPTIONS).toHaveLength(3);
    expect(copy(result, 'option_0')).toMatchObject({ title: CHOICE_OPTIONS[0]?.title });
    expect(copy(result, 'option_2')).toMatchObject({ title: CHOICE_OPTIONS[2]?.title });
    expect(result.warnings.filter((w) => !w.includes('below the fold'))).toEqual([]);
  });

  it('people_picker projects the seeded demo contacts', async () => {
    const result = await run({ state: fresh(), templateId: 'people_picker' });

    expect(CONTACTS).toHaveLength(3);
    expect(copy(result, 'person_0')).toEqual({ title: CONTACTS[0]?.name });
    expect(copy(result, 'confirm')).toEqual({ text: 'Pick someone first' });
    expect(result.warnings.filter((w) => !w.includes('below the fold'))).toEqual([]);
  });

  /**
   * Saying "Ari" repainted a screen identical to the one before it, so there
   * was no way to tell the device had heard — which reads exactly like the
   * selection doing nothing.
   */
  it('marks who has been chosen, so a selection is visible', async () => {
    const result = await run({ state: fresh(), templateId: 'people_picker', chosen: ['ari'] });

    expect(copy(result, 'person_0')).toEqual({ title: 'Ari', meta: 'Picked' });
    expect(copy(result, 'person_1')).toEqual({ title: 'Blake' });
    expect(String(copy(result, 'subtitle')?.text)).toContain('1 chosen');
    expect(copy(result, 'confirm')).toEqual({ text: 'Text 1' });
  });
});

describe('project — out of scope surfaces', () => {
  it('message_drafts and generic_answer are generated, not projected: no surface + a warning, never a throw', async () => {
    const drafts = await run({ state: fresh(), templateId: 'message_drafts' });
    const answer = await run({ state: fresh(), templateId: 'generic_answer' });

    expect(drafts.structure).toBeNull();
    expect(drafts.content).toBeNull();
    expect(drafts.warnings[0]).toContain('generated, not projected');
    expect(answer.structure).toBeNull();
  });
});

describe('project — never throws', () => {
  const broken: ReadonlyArray<[string, TaskState]> = [
    ['a NaN scale', { ...fresh(), scale: Number.NaN }],
    ['an infinite scale', { ...fresh(), scale: Number.POSITIVE_INFINITY }],
    ['a negative step index', { ...fresh(), stepIndex: -4 }],
    ['a bowl naming ingredients the recipe does not have', { ...fresh(), inBowl: { unobtainium: 3 } }],
    [
      'a recipe with no steps and no ingredients',
      { recipe: { ...CLASSIC_CHOCOLATE_CHIP, ingredients: [], steps: [] }, scale: 1, stepIndex: 0, inBowl: {} },
    ],
    [
      'a recipe whose fields are the wrong types',
      {
        recipe: {
          ...CLASSIC_CHOCOLATE_CHIP,
          baseYield: 'lots' as unknown as number,
          yieldUnit: null as unknown as string,
          ingredients: [null as unknown as (typeof CLASSIC_CHOCOLATE_CHIP)['ingredients'][number]],
        },
        scale: 1,
        stepIndex: 0,
        inBowl: {},
      },
    ],
  ];

  for (const [name, state] of broken) {
    for (const templateId of ['item_detail', 'focus_step', 'recovery', 'summary_done'] as const) {
      it(`${templateId} with ${name}: returns a result, and says why when there is no surface`, async () => {
        const result = await run({ state, templateId });
        // Either a surface, or no surface AND a stated reason. Never a throw,
        // and never a plausible-looking empty screen.
        if (result.structure === null) {
          expect(result.content).toBeNull();
          expect(result.warnings.join(' ')).toMatch(/project:/);
        } else {
          expect(result.content).not.toBeNull();
        }
      });
    }
  }

  it('a state that is not a state at all is reported, not thrown', async () => {
    const result = await run({ state: null as unknown as TaskState, templateId: 'item_detail' });

    expect(result.structure).toBeNull();
    expect(result.warnings.join(' ')).toContain('project:');
  });
});
