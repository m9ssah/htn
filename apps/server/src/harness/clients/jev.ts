import type { JevAnswer, JevClient } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

/**
 * The real HTTP client is P3's job (explicit keep-alive agent + budget cap).
 * Left as a documented stub here so a wrong Ctx shape fails loudly rather than
 * silently degrading to a fake network call.
 */
export const realJevClient: JevClient = {
  async ask(): Promise<JevAnswer> {
    throw new Error('realJevClient: not implemented until P3 (TS Jev client)');
  },
};

/** Hand-written, deterministic. No network, safe for CI. */
export const stubJevClient: JevClient = {
  async ask(_utterance, signal): Promise<JevAnswer> {
    await sleep(20, signal);
    return { templateId: 'generic_answer', confidence: 0.5 };
  },
};

/**
 * Reads a recorded answer from disk. CI-safe: no network, just a file read.
 *
 * Still threads `signal` through — an already-aborted turn must not return an
 * answer just because reading a fixture is fast. Replay is meant to stand in
 * for the real client in a cancellation test, not to short-circuit it.
 *
 * `sleep(0, signal)`, not `signal.throwIfAborted()` — see `content.ts`'s
 * matching comment. `throwIfAborted()` returns synchronously without ever
 * yielding, so a timer-scheduled abort (the normal case) would never get a
 * chance to land before this already returned. `sleep(0, ...)` still checks
 * synchronously if `signal` is already aborted, but otherwise yields once,
 * which is what lets a pending abort actually win the race.
 */
export function createReplayJevClient(fixturePath: string): JevClient {
  return {
    async ask(_utterance, signal): Promise<JevAnswer> {
      await sleep(0, signal);
      return readFixture<JevAnswer>(fixturePath);
    },
  };
}
