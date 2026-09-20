import type { Step } from './recipe.js';

/**
 * Timers, as arithmetic.
 *
 * Every number a timer puts on screen — minutes left, the percentage the
 * `Progress` bar fills to — is computed here from a start time and a
 * duration, never asked of a model (CLAUDE.md constraint 2). A timer is the
 * clearest case of that rule: a model that "counts down" is a model that
 * will eventually say 4:61.
 *
 * Pure and `now`-injected rather than reading the clock itself, so a test can
 * assert what the screen says at 0s, 10s and past the end without sleeping.
 */

export type Timer = {
  /** Wall-clock ms when the timer was started. */
  startedAt: number;
  durationMs: number;
};

export type TimerReading = {
  elapsedMs: number;
  /** Never negative — a finished timer reads 0, not -3000. */
  remainingMs: number;
  /** 0–100. `Progress.pct`'s catalog schema rejects anything outside that. */
  pct: number;
  done: boolean;
};

export const timerFor = (step: Step, startedAt: number): Timer | null =>
  step.seconds === undefined ? null : { startedAt, durationMs: step.seconds * 1000 };

export function readTimer(timer: Timer, now: number): TimerReading {
  const elapsedMs = Math.max(0, now - timer.startedAt);
  const remainingMs = Math.max(0, timer.durationMs - elapsedMs);
  // Clamped, not just computed. A device that slept through the end of a bake
  // comes back with elapsed > duration; an unclamped 118 would fail the
  // catalog's 0–100 bound and get the whole content patch rejected, turning a
  // finished timer into a blank slot.
  const pct = timer.durationMs <= 0 ? 100 : Math.min(100, Math.max(0, (elapsedMs / timer.durationMs) * 100));
  return { elapsedMs, remainingMs, pct, done: remainingMs === 0 };
}

/**
 * `m:ss`, rounding remaining time UP to the next whole second.
 *
 * Rounding down would show `0:00` for the timer's final second — a display
 * that says finished while the thing is still running is worse than one that
 * lingers a beat on `0:01`.
 */
export function formatDuration(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
