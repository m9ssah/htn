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

/**
 * Reads a recorded chunk list from disk. CI-safe: no network, just a file
 * read.
 *
 * Checks `signal` between chunks like the stub does — a replay source that
 * ignored it would be the exact failure mode this file's `signal` doc warns
 * about (p19b: a node that never checks keeps running after everyone has
 * stopped listening), just with a fixture standing in for the network call.
 *
 * `sleep(0, signal)`, not `signal.throwIfAborted()`. The check has to be a
 * macrotask yield: `throwIfAborted()` returns synchronously and never yields
 * control, so an abort scheduled on a timer (as every real cancellation is —
 * `p19b`'s "user speaks again" case) would never get a turn to land before
 * all three chunks had already been read and yielded. `sleep(0, ...)` still
 * checks synchronously if `signal` is already aborted (see `signal.ts`), but
 * otherwise waits one tick, which is what actually gives a pending abort the
 * chance to fire between chunks. Replacing this with `throwIfAborted()` would
 * pass every test in this file and still leak the whole read on a real abort
 * — the same "green test proves nothing" trap the replay tier was just in.
 */
export function createReplayContentSource(fixturePath: string): ContentSource {
  return {
    async *stream(_prompt, signal): AsyncGenerator<string> {
      const chunks = readFixture<string[]>(fixturePath);
      for (const chunk of chunks) {
        await sleep(0, signal);
        yield chunk;
      }
    },
  };
}
