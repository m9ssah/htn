import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { createJsonRenderer } from '@jit/renderer';
import { composeProjected, type ProjectedInput } from '../../src/compose/projected.js';
import { completeStep, type Recipe, type TaskState } from '../../src/domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../../src/domain/recipes.js';
import { CHOICE_OPTIONS, CONTACTS } from '../../src/seed.js';

/**
 * `SurfaceSpecSchema.parse` is NOT the device's gate. `validateSpec` inside
 * `json-renderer.tsx` adds element count, depth and reachability, and
 * `getActions()` returns `[]` *silently* past the hardware limits. The only
 * way to know a projected surface actually paints and actually drives the rail
 * is to put it through the real renderer.
 */

const ids = { requestId: 'req-1', generationId: 'gen-1' };
const fresh = (recipe: Recipe = CLASSIC_CHOCOLATE_CHIP): TaskState => ({ recipe, scale: 1, stepIndex: 0, inBowl: {} });

const midway = completeStep(completeStep(fresh()));
const deviated: TaskState = { ...midway, inBowl: { ...midway.inBowl, caster_sugar: 1.5 } };

const SURFACES: ReadonlyArray<[string, ProjectedInput, string[]]> = [
  ['item_detail', { kind: 'item_detail', state: fresh() }, ['set_batch', 'begin']],
  ['focus_step', { kind: 'focus_step', state: midway }, ['prev_step', 'next_step']],
  ['recovery', { kind: 'recovery', state: deviated }, ['start_over', 'apply_fix']],
  ['summary_done', { kind: 'summary_done', state: { ...fresh(), scale: 2, stepIndex: 7 } }, ['share']],
  [
    'choice_cards',
    { kind: 'choice_cards', options: CHOICE_OPTIONS },
    ['set_effort', ...CHOICE_OPTIONS.map((o) => `select_${o.id}`)],
  ],
  [
    'people_picker',
    { kind: 'people_picker', contacts: CONTACTS },
    [...CONTACTS.map((c) => `choose_${c.id}`), 'write_messages'],
  ],
];

describe('projected surfaces survive the real renderer', () => {
  for (const [name, input, actions] of SURFACES) {
    it(`${name}: paints, resolves every shimmer, and drives the rail`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok, result.ok ? '' : result.reason).toBe(true);
      if (!result.ok) return;

      const host = document.createElement('div');
      const renderer = createJsonRenderer(host);
      flushSync(() => {
        expect(renderer.apply(result.structure)).toEqual({ ok: true });
        expect(renderer.apply(result.content)).toEqual({ ok: true });
      });

      // Nothing left shimmering: ADR 0001's added invariant.
      expect(host.querySelectorAll('[data-shimmer]')).toHaveLength(0);

      const got = renderer.getActions();
      expect(got.map((a) => a.action)).toEqual(actions);
      for (const action of got) expect(action.label, `${action.elementId} has no label`).not.toBeNull();

      // Every bound element actually has text on screen.
      for (const [elementId, values] of Object.entries(result.content.values)) {
        const node = host.querySelector(`[data-slot="${elementId}"]`);
        expect(node, `${elementId} did not render`).not.toBeNull();
        for (const value of Object.values(values)) {
          if (typeof value === 'string' && value.length > 0) expect(node?.textContent).toContain(value);
        }
      }
      renderer.destroy();
    });
  }

  it('the batch slider reaches the rail with the numbers the domain computed', () => {
    const result = composeProjected({ kind: 'item_detail', state: { ...fresh(), scale: 2 } }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const host = document.createElement('div');
    const renderer = createJsonRenderer(host);
    flushSync(() => {
      renderer.apply(result.structure);
      renderer.apply(result.content);
    });
    const range = renderer.getActions().find((a) => a.kind === 'range');
    expect(range?.range).toEqual({ min: 18, max: 54, step: 6, value: 36, unit: 'cookies', minLabel: null, maxLabel: null });
    expect(range?.label).toBe('Batch size');
    renderer.destroy();
  });
});
