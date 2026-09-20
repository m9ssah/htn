import { describe, expect, it } from 'vitest';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { project } from '../../../src/harness/nodes/project.js';
import { applyDeviation, completeStep, setYield, type TaskState } from '../../../src/domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../../../src/domain/recipes.js';
import { CHOICE_OPTIONS, CONTACTS } from '../../../src/seed.js';

const ctx = createStubCtx(new AbortController().signal);

const fresh = (): TaskState => ({ recipe: CLASSIC_CHOCOLATE_CHIP, scale: 1, stepIndex: 0, inBowl: {} });

describe('project — item_detail', () => {
  it('fills title/subtitle/axis and folds the 9th ingredient into the 8th row rather than dropping it', async () => {
    const { patch, warnings } = await project.run({ state: fresh(), templateId: 'item_detail' }, ctx);

    expect(patch.slots['item_detail.title']).toEqual({ kind: 'Heading', text: 'Classic Chocolate Chip' });
    expect(patch.slots['item_detail.axis']).toMatchObject({ kind: 'Slider', unit: 'cookies', value: 18 });

    // 9 ingredients, 8 reserved rows: constraint 5 forbids silently dropping
    // one, so the 8th row must visibly carry both the 8th AND 9th ingredient.
    const line8 = patch.slots['item_detail.line8'];
    expect(line8).not.toBeNull();
    expect((line8 as { title: string }).title).toContain('Salt');
    expect(warnings.some((w) => w.includes('overflowed'))).toBe(true);
  });

  it('never leaves a reserved line slot as "pending" (undefined) — project is a one-shot patch', async () => {
    const { patch } = await project.run({ state: fresh(), templateId: 'item_detail' }, ctx);
    const lineSlots = [
      'item_detail.line1',
      'item_detail.line2',
      'item_detail.line3',
      'item_detail.line4',
      'item_detail.line5',
      'item_detail.line6',
      'item_detail.line7',
      'item_detail.line8',
    ] as const;

    for (const slot of lineSlots) {
      expect(patch.slots[slot]).not.toBeUndefined();
    }
  });

  it('is total: an empty-ingredient recipe does not throw, and every line collapses to null', async () => {
    const empty: TaskState = { recipe: { ...CLASSIC_CHOCOLATE_CHIP, ingredients: [] }, scale: 1, stepIndex: 0, inBowl: {} };

    const { patch } = await project.run({ state: empty, templateId: 'item_detail' }, ctx);

    expect(patch.slots['item_detail.line1']).toBeNull();
    expect(patch.slots['item_detail.line8']).toBeNull();
  });
});

describe('project — focus_step', () => {
  it('shows the current step and hides prev on the first step', async () => {
    const { patch } = await project.run({ state: fresh(), templateId: 'focus_step' }, ctx);

    expect(patch.slots['focus_step.instruction']).toEqual({ kind: 'Heading', text: 'Cream the butter and sugars' });
    expect(patch.slots['focus_step.prev']).toBeNull();
    expect(patch.slots['focus_step.next']).not.toBeNull();
    expect(patch.slots['focus_step.done']).toBeNull();
  });

  it('shows done instead of next on the last step, and prev once past the first', async () => {
    const state: TaskState = { ...fresh(), stepIndex: CLASSIC_CHOCOLATE_CHIP.steps.length - 1 };

    const { patch } = await project.run({ state, templateId: 'focus_step' }, ctx);

    expect(patch.slots['focus_step.prev']).not.toBeNull();
    expect(patch.slots['focus_step.next']).toBeNull();
    expect(patch.slots['focus_step.done']).not.toBeNull();
  });

  it('is total: a stepIndex past the end does not throw', async () => {
    const state: TaskState = { ...fresh(), stepIndex: 999 };

    const { patch, warnings } = await project.run({ state, templateId: 'focus_step' }, ctx);

    expect(patch.slots['focus_step.instruction']).toEqual({ kind: 'Heading', text: 'All steps complete' });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('project — recovery', () => {
  it('diagnoses the worst deviation already present in the TaskState and recommends scaling up', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    state = applyDeviation(state, 'caster_sugar', 2); // over-addition — scalable

    const { patch, warnings } = await project.run({ state, templateId: 'recovery' }, ctx);

    expect(patch.slots['recovery.title']).toEqual({ kind: 'Heading', text: 'Caster sugar looks off' });
    expect(patch.slots['recovery.primary']).toEqual({ kind: 'Button', text: 'Scale up to 60' });
    expect(patch.slots['recovery.outcome']).toEqual({ kind: 'Metric', label: 'New cookies', value: '60', delta: '+30' });
    // The topup text is what makes this the recovery beat's actual content —
    // ingredients already caught up to the new scale (caster_sugar, the
    // deviation itself) must not appear; ones that still need more must.
    const planText = (patch.slots['recovery.plan'] as { text: string }).text;
    expect(planText).toContain('Scale the whole batch to 60 cookies');
    expect(planText).toContain('more butter');
    expect(planText).not.toContain('caster sugar');
    expect(warnings).toEqual([]);
  });

  it('applies a Jev-supplied ingredient+factor choice locally when the TaskState has not been corrected yet', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    // NOT applying the deviation to `state` itself — project must derive it.

    const { patch } = await project.run(
      { state, templateId: 'recovery', deviation: { ingredientId: 'caster_sugar', factor: '2x' } },
      ctx,
    );

    expect(patch.slots['recovery.title']).toEqual({ kind: 'Heading', text: 'Caster sugar looks off' });
  });

  it('an under-addition cannot be scaled away — collapses the primary button rather than duplicating "Start over"', async () => {
    let state = setYield(fresh(), 30);
    state = completeStep(state);
    state = completeStep(state);
    state = applyDeviation(state, 'caster_sugar', 0.5); // under-addition

    const { patch } = await project.run({ state, templateId: 'recovery' }, ctx);

    expect(patch.slots['recovery.primary']).toBeNull();
    expect(patch.slots['recovery.secondary']).toEqual({ kind: 'Button', text: 'Start over' });
  });

  it('a deviation factor of "other" cannot be computed and is skipped with a warning, not a throw', async () => {
    const state = fresh();

    const { patch, warnings } = await project.run(
      { state, templateId: 'recovery', deviation: { ingredientId: 'caster_sugar', factor: 'other' } },
      ctx,
    );

    expect(patch.slots['recovery.title']).toEqual({ kind: 'Heading', text: 'Nothing to correct' });
    expect(warnings.some((w) => w.includes('other'))).toBe(true);
  });

  it('is total: no deviation anywhere still renders a neutral surface with a warning, not a throw', async () => {
    const { patch, warnings } = await project.run({ state: fresh(), templateId: 'recovery' }, ctx);

    expect(patch.slots['recovery.title']).toEqual({ kind: 'Heading', text: 'Nothing to correct' });
    expect(warnings.some((w) => w.includes('no deviation'))).toBe(true);
  });
});

describe('project — summary_done / choice_cards / people_picker', () => {
  it('summary_done reports the current yield', async () => {
    const { patch } = await project.run({ state: setYield(fresh(), 36), templateId: 'summary_done' }, ctx);

    expect(patch.slots['summary_done.result']).toEqual({ kind: 'Metric', label: 'Yield', value: '36 cookies' });
  });

  it('choice_cards projects the 3 seeded demo options — clearly seed data, not derived', async () => {
    const { patch, warnings } = await project.run({ state: fresh(), templateId: 'choice_cards' }, ctx);

    expect(CHOICE_OPTIONS).toHaveLength(3);
    expect(patch.slots['choice_cards.option1']).toMatchObject({ kind: 'ListItem', title: CHOICE_OPTIONS[0]?.title });
    expect(patch.slots['choice_cards.option3']).toMatchObject({ kind: 'ListItem', title: CHOICE_OPTIONS[2]?.title });
    expect(warnings).toEqual([]);
  });

  it('people_picker projects the seeded demo contacts', async () => {
    const { patch, warnings } = await project.run({ state: fresh(), templateId: 'people_picker' }, ctx);

    expect(CONTACTS).toHaveLength(3);
    expect(patch.slots['people_picker.person1']).toEqual({ kind: 'ListItem', title: CONTACTS[0]?.name });
    expect(patch.slots['people_picker.confirm']).toEqual({ kind: 'Button', text: 'Send messages' });
    expect(warnings).toEqual([]);
  });
});

describe('project — out of scope templates', () => {
  it('message_drafts and generic_answer are generated, not projected: empty patch + a warning, never a throw', async () => {
    const drafts = await project.run({ state: fresh(), templateId: 'message_drafts' }, ctx);
    const answer = await project.run({ state: fresh(), templateId: 'generic_answer' }, ctx);

    expect(drafts.patch.slots).toEqual({});
    expect(drafts.warnings[0]).toContain('generated, not projected');
    expect(answer.patch.slots).toEqual({});
  });
});
