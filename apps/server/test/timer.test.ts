import { describe, expect, it } from 'vitest';
import { formatDuration, readTimer, timerFor } from '../src/domain/timer.js';
import { composeProjected } from '../src/compose/projected.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../src/domain/recipes.js';
import { estimateCost, type TaskState } from '../src/domain/recipe.js';

const T0 = 1_700_000_000_000;
const state = (stepIndex: number): TaskState => ({
  recipe: CLASSIC_CHOCOLATE_CHIP,
  scale: 1,
  stepIndex,
  inBowl: {},
});

const ids = { requestId: 'r', generationId: 'g' };

describe('readTimer', () => {
  const timer = { startedAt: T0, durationMs: 60_000 };

  it('reads full at the start and empty at the end', () => {
    expect(readTimer(timer, T0)).toMatchObject({ remainingMs: 60_000, pct: 0, done: false });
    expect(readTimer(timer, T0 + 60_000)).toMatchObject({ remainingMs: 0, pct: 100, done: true });
  });

  it('clamps past the end rather than reporting a percentage the catalog rejects', () => {
    // Progress.pct is bounded 0-100 by the catalog schema; an unclamped read
    // after a long sleep would fail validation and blank the slot.
    const late = readTimer(timer, T0 + 10 * 60_000);
    expect(late.pct).toBe(100);
    expect(late.remainingMs).toBe(0);
    expect(late.done).toBe(true);
  });

  it('never reports negative remaining time or a pre-start elapsed', () => {
    expect(readTimer(timer, T0 - 5_000).elapsedMs).toBe(0);
    expect(readTimer(timer, T0 + 90_000).remainingMs).toBe(0);
  });

  it('a zero-length timer is done, not a division by zero', () => {
    expect(readTimer({ startedAt: T0, durationMs: 0 }, T0)).toMatchObject({ pct: 100, done: true });
  });
});

describe('formatDuration', () => {
  it('rounds up, so a running timer never shows 0:00 while still running', () => {
    expect(formatDuration(1)).toBe('0:01');
    expect(formatDuration(999)).toBe('0:01');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('pads seconds', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(11 * 60_000)).toBe('11:00');
    expect(formatDuration(20 * 60_000)).toBe('20:00');
  });
});

describe('timerFor', () => {
  it('is null for a step you finish when you finish', () => {
    const scoop = CLASSIC_CHOCOLATE_CHIP.steps.find((s) => s.id === 's6')!;
    expect(timerFor(scoop, T0)).toBeNull();
  });

  it('carries the declared duration for a wait', () => {
    const bake = CLASSIC_CHOCOLATE_CHIP.steps.find((s) => s.id === 's7')!;
    expect(timerFor(bake, T0)).toEqual({ startedAt: T0, durationMs: 11 * 60_000 });
  });
});

describe('focus_step timer', () => {
  it('shows a timer on the bake step', () => {
    const bakeIndex = CLASSIC_CHOCOLATE_CHIP.steps.findIndex((s) => s.id === 's7');

    const result = composeProjected({ kind: 'focus_step', state: state(bakeIndex) }, { ...ids, now: T0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structure.spec.elements.timer_bar).toMatchObject({ type: 'Progress', props: { pct: 0 } });
    expect(result.content.values.timer_remaining).toMatchObject({ value: '11:00', label: 'Time left' });
  });

  it('shows no timer on a step that declares no duration', () => {
    const scoopIndex = CLASSIC_CHOCOLATE_CHIP.steps.findIndex((s) => s.id === 's6');

    const result = composeProjected({ kind: 'focus_step', state: state(scoopIndex) }, { ...ids, now: T0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structure.spec.elements.timer_bar).toBeUndefined();
    expect(result.structure.spec.elements.timer_remaining).toBeUndefined();
  });

  /**
   * The bug this caught: with `startedAt` stamped at paint time the timer
   * restarted on every repaint and read 11:00 for ever. The origin has to come
   * from task state.
   */
  it('advances with the clock rather than repainting the same number', () => {
    const bakeIndex = CLASSIC_CHOCOLATE_CHIP.steps.findIndex((s) => s.id === 's7');
    const baking: TaskState = { ...state(bakeIndex), stepStartedAt: T0 };

    const later = composeProjected({ kind: 'focus_step', state: baking }, { ...ids, now: T0 + 60_000 });

    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.content.values.timer_remaining).toMatchObject({ value: '10:00' });
    expect(later.structure.spec.elements.timer_bar?.props.pct).toBeCloseTo(100 / 11, 5);
  });
});

describe('item_detail cost breakdown', () => {
  const result = composeProjected({ kind: 'item_detail', state: state(0) }, { ...ids, now: T0 });

  it('charts the batch cost', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structure.spec.elements.cost_bars?.type).toBe('Bars');
  });

  it('bars sum to the total shown beside them', () => {
    if (!result.ok) return;
    const values = result.structure.spec.elements.cost_bars?.props.values as number[];
    const summed = values.reduce((a, b) => a + b, 0);
    const total = estimateCost(state(0)).total;

    // Per-bar values are rounded to cents, so allow a cent of drift per bar.
    expect(Math.abs(summed - total)).toBeLessThanOrEqual(values.length * 0.01);
  });

  it('stays inside the Bars catalog bound of 12 by folding the tail into one bar', () => {
    if (!result.ok) return;
    const values = result.structure.spec.elements.cost_bars?.props.values as number[];

    expect(values.length).toBeGreaterThan(0);
    expect(values.length).toBeLessThanOrEqual(12);
    // 9 priced ingredients, 6 bars max -> 5 named + 1 "others".
    expect(values).toHaveLength(6);
    expect(result.content.values.cost_legend?.text).toContain('others');
  });

  it('puts the money in fixed props, never in generated content', () => {
    if (!result.ok) return;
    // Bars carries no generated field at all — `values` is a business fact.
    expect(result.content.values.cost_bars).toBeUndefined();
  });
});
