import { describe, expect, it } from 'vitest';
import { sleep } from '../../src/harness/signal.js';

/**
 * `sleep`'s abort listener used to be removed only on the abort path
 * (`{ once: true }` covers just that). On normal resolution it was never
 * unregistered, so a turn with many chunks left one listener per chunk on the
 * signal for the rest of the turn. Pins the fix so it can't silently regress.
 *
 * A hand-rolled fake signal, not a real `AbortController`'s — under vitest's
 * `happy-dom` environment, `AbortSignal` is happy-dom's own implementation,
 * which `node:events`' `getEventListeners` doesn't recognise as an
 * `EventTarget`. Counting `addEventListener`/`removeEventListener` calls
 * directly is what actually pins the fix regardless of environment.
 */
describe('sleep', () => {
  it('removes its abort listener on normal resolution, not just on abort', async () => {
    let added = 0;
    let removed = 0;
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: () => {
        added++;
      },
      removeEventListener: () => {
        removed++;
      },
    } as unknown as AbortSignal;

    for (let i = 0; i < 5; i++) {
      await sleep(0, signal);
    }

    expect(added).toBe(5);
    expect(removed).toBe(5);
  });
});
