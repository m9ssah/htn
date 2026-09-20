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

    const run = generate.run('recipe', ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    // The rejection itself is the proof: a node that ran to completion
    // despite the abort would resolve, not reject.
    await expect(run).rejects.toThrow('barge-in');
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

    const run = generate.run('recipe', ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    // Getting all 3 chunks despite the abort at 5ms IS the proof it never
    // stopped — a cooperative node would have rejected like the test above.
    await expect(run).resolves.toHaveLength(3);
  });
});
