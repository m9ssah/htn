import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReplayJevClient } from '../../../src/harness/clients/jev.js';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { policy } from '../../../src/harness/nodes/policy.js';
import type { JevAnswer } from '../../../src/harness/types.js';

/**
 * `policy` decides whether `decide`'s naive `templateId` actually gets
 * applied. Tested against the 4 live-recorded fixtures (one per branch) so
 * the table below is checked against real Jev output, not a guess at its
 * shape — per the P2 brief, "confirmed contents" of
 * `fixtures/jev/recorded/{new_task,refine,correct,select}.json`.
 */
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/jev/recorded');
const anyState = { utterance: 'x', currentTemplate: null, taskState: '' };
const ctx = createStubCtx(new AbortController().signal);

async function recordedAnswer(name: string): Promise<JevAnswer> {
  const client = createReplayJevClient(join(FIXTURES_DIR, `${name}.json`));
  return client.ask(anyState, new AbortController().signal);
}

describe('policy', () => {
  it('new_task: honours Jev (route=new_task 0.4, templateId=choice_cards 0.98, current=null)', async () => {
    const jev = await recordedAnswer('new_task');

    const result = await policy.run(
      { route: jev.route.value, jevTemplateId: jev.templateId.value, currentTemplate: null },
      ctx,
    );

    expect(result).toEqual({ templateId: 'choice_cards', rule: 'honour_jev' });
  });

  it('refine: keeps the current template (control case — Jev also said item_detail here, 0.68)', async () => {
    const jev = await recordedAnswer('refine');
    expect(jev.templateId.value).toBe('item_detail'); // this fixture happens to agree with current

    const result = await policy.run(
      { route: jev.route.value, jevTemplateId: jev.templateId.value, currentTemplate: 'item_detail' },
      ctx,
    );

    expect(result).toEqual({ templateId: 'item_detail', rule: 'refine_keep' });
  });

  it('refine: the actual divergence — backend/results/p18_route.json records templateId=focus_step for this exact utterance/current pair, and policy must not swap the surface out from under the user', async () => {
    // Constructed rather than replayed via createReplayJevClient: p18's run is
    // a probe result file (backend/results/p18_route.json, row for "make it
    // high contrast, I can't read this" / currentTemplate item_detail ->
    // template focus_step), not a `{state, response}` Jev fixture — the
    // recorded refine.json fixture above is a DIFFERENT run of the same
    // utterance that happened to land on a matching template instead.
    const result = await policy.run(
      { route: 'refine', jevTemplateId: 'focus_step', currentTemplate: 'item_detail' },
      ctx,
    );

    expect(result).toEqual({ templateId: 'item_detail', rule: 'refine_keep' });
    expect(result.templateId).not.toBe('focus_step');
  });

  it('correct: keeps current (no deviation in the TaskState yet) even though Jev said recovery at 0.97', async () => {
    const jev = await recordedAnswer('correct');
    expect(jev.templateId.value).toBe('recovery');

    const result = await policy.run(
      { route: jev.route.value, jevTemplateId: jev.templateId.value, currentTemplate: 'focus_step', hasDeviation: false },
      ctx,
    );

    expect(result).toEqual({ templateId: 'focus_step', rule: 'correct_keep' });
  });

  it('correct: switches to recovery once the TaskState actually shows a deviation', async () => {
    const jev = await recordedAnswer('correct');

    const result = await policy.run(
      { route: jev.route.value, jevTemplateId: jev.templateId.value, currentTemplate: 'focus_step', hasDeviation: true },
      ctx,
    );

    expect(result).toEqual({ templateId: 'recovery', rule: 'correct_recovery' });
  });

  it('select: with no touched slot (voice, "the second one"), keeps current — diverging from Jevs item_detail at 0.9', async () => {
    const jev = await recordedAnswer('select');
    expect(jev.templateId.value).toBe('item_detail');

    const result = await policy.run(
      { route: jev.route.value, jevTemplateId: jev.templateId.value, currentTemplate: 'choice_cards' },
      ctx,
    );

    expect(result).toEqual({ templateId: 'choice_cards', rule: 'select_keep' });
  });

  it('select: a touched choice_cards option deterministically opens item_detail — no model involved', async () => {
    const jev = await recordedAnswer('select');

    const result = await policy.run(
      {
        route: jev.route.value,
        jevTemplateId: jev.templateId.value,
        currentTemplate: 'choice_cards',
        touchedSlot: 'choice_cards.option2',
      },
      ctx,
    );

    expect(result).toEqual({ templateId: 'item_detail', rule: 'select_mapped' });
  });

  it('select: a touched slot with no table entry keeps current rather than guessing', async () => {
    const result = await policy.run(
      { route: 'select', jevTemplateId: 'item_detail', currentTemplate: 'people_picker', touchedSlot: 'people_picker.person1' },
      ctx,
    );

    expect(result).toEqual({ templateId: 'people_picker', rule: 'select_keep' });
  });

  it('other / no current surface: total fallback is honouring Jev, not throwing', async () => {
    const result = await policy.run({ route: 'other', jevTemplateId: 'generic_answer', currentTemplate: null }, ctx);

    expect(result).toEqual({ templateId: 'generic_answer', rule: 'honour_jev' });
  });
});

describe('policy — reconciling against what the task state can build', () => {
  const ctx = createStubCtx(new AbortController().signal);

  /**
   * The opening-utterance defect, measured live before this existed.
   * `route` was `new_task` at 1.00 for all four phrasings of "I want to bake
   * cookies", but `templateId` was not stable: choice_cards 0.67,
   * focus_step 0.49, choice_cards 0.47, focus_step 0.38. Two of the four
   * named a surface that is a projection of a task, with no task open — so
   * the composer refused and the device painted NOTHING on the first thing
   * the user says.
   */
  it.each(['item_detail', 'focus_step', 'recovery', 'summary_done'] as const)(
    'reprojects %s to choice_cards when no task is open, and says so',
    async (jevTemplateId) => {
      const result = await policy.run(
        { route: 'new_task', jevTemplateId, currentTemplate: null, hasTask: false },
        ctx,
      );

      expect(result).toEqual({ templateId: 'choice_cards', rule: 'no_task_reprojected' });
    },
  );

  it.each(['choice_cards', 'people_picker', 'message_drafts', 'generic_answer'] as const)(
    'leaves %s alone with no task — it stands on its own',
    async (jevTemplateId) => {
      const result = await policy.run(
        { route: 'new_task', jevTemplateId, currentTemplate: null, hasTask: false },
        ctx,
      );

      expect(result).toEqual({ templateId: jevTemplateId, rule: 'honour_jev' });
    },
  );

  it('does not interfere once a task IS open', async () => {
    const result = await policy.run(
      { route: 'new_task', jevTemplateId: 'focus_step', currentTemplate: 'item_detail', hasTask: true },
      ctx,
    );

    expect(result).toEqual({ templateId: 'focus_step', rule: 'honour_jev' });
  });

  it('is inert when the caller does not say — hasTask is optional, not defaulted to false', async () => {
    const result = await policy.run(
      { route: 'new_task', jevTemplateId: 'focus_step', currentTemplate: null },
      ctx,
    );

    expect(result.templateId).toBe('focus_step');
  });
});
