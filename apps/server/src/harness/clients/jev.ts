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

/** Reads a recorded answer from disk. CI-safe: no network, just a file read. */
export function createReplayJevClient(fixturePath: string): JevClient {
  return {
    async ask(): Promise<JevAnswer> {
      return readFixture<JevAnswer>(fixturePath);
    },
  };
}
