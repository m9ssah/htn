import { describe, expect, it } from 'vitest';
import type { ContentPatch } from '@jit/schema';
import { generate } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import { sleep } from '../../src/harness/signal.js';
import type { ContentSource } from '../../src/harness/types.js';

const LINES = [
  '[]',
  '{"slot":"generic_answer.action","value":{"text":"Ok"}}',
  '{"slot":"generic_answer.title","value":{"text":"Title"}}',
];

/**
 * `backend/probes/p19b_langgraph_cancel.mjs` measured that cancellation is
 * cooperative: aborting the signal does nothing on its own. Only a node that
 * threads `signal` into its own `await` actually stops.
 *
 * Unlike P1's placeholder `generate` (whose cancellation depended entirely on
 * whatever `ContentSource` it was given), the real `generate` checks
 * `ctx.signal` itself between slots (`await sleep(0, ctx.signal)` — see
 * `harness/nodes/generate.ts`). So both cases below now stop, including the
 * one built on a source that never looks at the signal — p19b's actual
 * failure mode. That is a strictly stronger property than P1's version,
 * which only proved the signal-honouring source stopped and documented the
 * other case as a known gap.
 */
describe('cancellation', () => {
  it('generate stops early when aborted, via a signal-honouring source', async () => {
    const store = createMemorySinkStore();
    const controller = new AbortController();
    const ctx = createStubCtx(controller.signal, store);
    const honouring: ContentSource = {
      async *stream(_prompt, signal): AsyncGenerator<string> {
        for (const line of LINES) {
          await sleep(15, signal);
          yield line;
        }
      },
    };
    ctx.content = honouring;

    const run = generate.run({ templateId: 'generic_answer', utterance: 'recipe' }, ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    await expect(run).rejects.toThrow('barge-in');
    expect(store.patches).toHaveLength(0);
  });

  it('generate stops early even when the content source itself ignores the signal', async () => {
    const store = createMemorySinkStore();
    const controller = new AbortController();
    const ctx = createStubCtx(controller.signal, store);
    // Deliberately identical to the source above, minus the signal check —
    // p19b's actual failure mode, not a hypothetical one.
    const ignoresSignal: ContentSource = {
      async *stream(): AsyncGenerator<string> {
        for (const line of LINES) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          yield line;
        }
      },
    };
    ctx.content = ignoresSignal;

    const run = generate.run({ templateId: 'generic_answer', utterance: 'recipe' }, ctx);
    setTimeout(() => controller.abort(new Error('barge-in')), 5);

    // Zero slots emitted after the abort — generate's own `sleep(0,
    // ctx.signal)` check between slots stops it even though the source would
    // happily keep yielding.
    await expect(run).rejects.toThrow('barge-in');
    expect(store.patches as ContentPatch[]).toHaveLength(0);
  });
});
