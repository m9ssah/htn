import type { ContentSource } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

/** The real LLM streaming client is P5's job. Documented stub until then. */
export const realContentSource: ContentSource = {
  async *stream(): AsyncGenerator<string> {
    throw new Error('realContentSource: not implemented until P5 (LLM streaming client)');
  },
};

/**
 * Hand-written, deterministic. Sleeps between chunks with the abortable
 * `sleep`, so this stub actually models cancellation rather than merely
 * declaring it — a node built on top of it is only cooperative if it also
 * threads `signal` through, but the stub itself cannot fake that away.
 */
export const stubContentSource: ContentSource = {
  async *stream(prompt, signal): AsyncGenerator<string> {
    const chunks = [`slot 1 for "${prompt}"`, 'slot 2', 'slot 3'];
    for (const chunk of chunks) {
      await sleep(15, signal);
      yield chunk;
    }
  },
};

/** Reads a recorded chunk list from disk. CI-safe: no network, just a file read. */
export function createReplayContentSource(fixturePath: string): ContentSource {
  return {
    async *stream(): AsyncGenerator<string> {
      const chunks = readFixture<string[]>(fixturePath);
      for (const chunk of chunks) yield chunk;
    },
  };
}
