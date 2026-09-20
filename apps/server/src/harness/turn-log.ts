import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The turn log: one structured JSONL line per turn, appended to a file.
 *
 * Buffered in memory and flushed ONCE, in a `finally`. That is a reliability
 * requirement, not a style preference — `p19c`/`p19d` measured that a node
 * error reaching the stream controller resets its queue, discarding chunks
 * enqueued but not yet read (6/6 delivered at 0ms consumer lag, 2/6 at
 * 300ms). Any `await` or filesystem call on the emit path recreates exactly
 * that lag. So: record synchronously into an array, pay the I/O once, after
 * the patches have stopped.
 *
 * Flushing in a `finally` is what makes a *crashed* or *aborted* turn the
 * most interesting line in the file rather than the one that is missing.
 *
 * One line per turn, with `turnId` as the first key, so `grep <turnId>` on
 * the file reconstructs the whole turn — the decision, every patch, every
 * node timing, every dropped patch (plan, "Observability"; done-when 6).
 */

export type TurnLogEntry = {
  /** ms since the turn started. */
  t: number;
  kind: string;
  [key: string]: unknown;
};

export type TurnLog = {
  readonly turnId: string;
  readonly entries: readonly TurnLogEntry[];
  record(kind: string, data?: Record<string, unknown>): void;
  /** Idempotent — the `finally` that calls it may run after an explicit call. */
  flush(outcome?: string): void;
};

export const DEFAULT_TURN_LOG_PATH = process.env.JIT_TURN_LOG ?? 'turns.jsonl';

/**
 * `path: null` keeps the buffer in memory and writes nothing — what a unit
 * test wants, and the one case where "no file" is a choice rather than a
 * swallowed failure.
 */
export function createTurnLog(turnId: string, path: string | null, now: () => number): TurnLog {
  const startedAt = now();
  const entries: TurnLogEntry[] = [];
  let flushed = false;

  return {
    turnId,
    get entries(): readonly TurnLogEntry[] {
      return entries;
    },
    record(kind, data): void {
      entries.push({ t: Math.round(now() - startedAt), kind, ...data });
    },
    flush(outcome = 'ok'): void {
      if (flushed) return;
      flushed = true;
      if (path === null) return;
      // `turnId` first so the grep target is unmissable at the head of the line.
      const line = JSON.stringify({ turnId, outcome, ms: Math.round(now() - startedAt), entries });
      try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${line}\n`);
      } catch (err) {
        // Constraint 5: never hide a failure. The turn already succeeded or
        // failed on its own terms; losing the log must not also take down
        // the turn, but it must be visible.
        console.error(`turn-log: could not append to ${path}:`, err);
      }
    },
  };
}

/**
 * Replaces a value that is about to be JSON-stringified into the log.
 * `Error` does not serialise (`JSON.stringify(new Error('x'))` is `{}`),
 * which would make every fault line in the log read as an empty object —
 * the one line you actually go looking for.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
