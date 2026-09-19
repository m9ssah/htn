import { describe, expect, it } from 'vitest';
import { generate } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import type { ContentSource } from '../../src/harness/types.js';

/**
 * `backend/probes/p19b_langgraph_cancel.mjs` measured that cancellation is
 * cooperative: aborting the signal does nothing on its own. Only a node that
 * threads `signal` into its own `await` actually stops. `stubContentSource`
 * (used by the `generate` demo node) is built on the abortable `sleep`
 * helper, so it models that correctly — this proves it, and contrasts it
 * against a source that ignores the signal, which does not stop.
 */
describe('cancellation', () => {
  it('a node built on the signal-honouring stub stops early when aborted', async () => {
    const controller = new AbortController();
    const ctx = createStubCtx(controller.signal);

    const t0 = performance.now();
    const run = generate.run('recipe', ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    await expect(run).rejects.toThrow('barge-in');
    const elapsed = performance.now() - t0;

    // The rejection already proves the loop didn't run to completion; this is
    // just a sanity margin against the stub's full 45ms (3 chunks x 15ms).
    expect(elapsed).toBeLessThan(45);
  });

  it('a node built on a signal-ignoring source does NOT stop early', async () => {
    // Documents the failure mode the plan warns about: identical shape, but
    // this source never looks at `signal`, so aborting it changes nothing.
    const ignoresSignal: ContentSource = {
      async *stream(prompt) {
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          yield `${prompt} ${i}`;
        }
      },
    };
    const controller = new AbortController();
    const ctx = createStubCtx(controller.signal);
    ctx.content = ignoresSignal;

    const t0 = performance.now();
    const run = generate.run('recipe', ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    const chunks = await run;
    const elapsed = performance.now() - t0;

    expect(chunks).toHaveLength(3);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
