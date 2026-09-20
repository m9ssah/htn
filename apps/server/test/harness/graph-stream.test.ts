import { describe, expect, it } from 'vitest';
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';

/**
 * The two LangGraph facts the whole wiring rests on, asserted against the
 * installed version rather than trusted from a probe log. Both are silent if
 * they change: the first alters the payload shape with no type error, the
 * second turns "paint first" into "paint at the end."
 *
 * Measured originally in `backend/probes/p19_langgraph_stream.mjs` against
 * @langchain/langgraph 1.4.16.
 */

const S = Annotation.Root({ ticks: Annotation<number> });

describe('LangGraph streaming contract', () => {
  it('streamMode "custom" (string) yields bare payloads; ["custom"] (array) yields [mode, payload] tuples', async () => {
    const graph = new StateGraph(S)
      .addNode('emit', async (_state, config: LangGraphRunnableConfig) => {
        config.writer?.({ n: 1 });
        return { ticks: 1 };
      })
      .addEdge(START, 'emit')
      .addEdge('emit', END)
      .compile();

    const bare: unknown[] = [];
    for await (const chunk of await graph.stream({ ticks: 0 }, { streamMode: 'custom' })) bare.push(chunk);

    const tupled: unknown[] = [];
    for await (const chunk of await graph.stream({ ticks: 0 }, { streamMode: ['custom'] })) tupled.push(chunk);

    expect(bare).toEqual([{ n: 1 }]);
    expect(Array.isArray(bare[0])).toBe(false);
    // The array form, even with ONE entry, changes the shape. `turn.ts`
    // destructures `[, payload]` and therefore must always pass the array.
    expect(tupled).toEqual([['custom', { n: 1 }]]);
  });

  /**
   * Deterministic, not timing-based: the second node cannot finish until the
   * test resolves a promise, and the test does not resolve it until it has
   * already received the first node's patch. If the stream batched at graph
   * exit this deadlocks and the test times out.
   */
  it('delivers a patch to the consumer while a later node is still running', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slowNodeFinished = false;

    const graph = new StateGraph(S)
      .addNode('fast', async (_state, config: LangGraphRunnableConfig) => {
        config.writer?.({ kind: 'skeleton' });
        return { ticks: 1 };
      })
      .addNode('slow', async (_state, config: LangGraphRunnableConfig) => {
        await held;
        slowNodeFinished = true;
        config.writer?.({ kind: 'content' });
        return { ticks: 2 };
      })
      .addEdge(START, 'fast')
      .addEdge('fast', 'slow')
      .addEdge('slow', END)
      .compile();

    const got: string[] = [];
    for await (const chunk of await graph.stream({ ticks: 0 }, { streamMode: ['custom'] })) {
      const [, payload] = chunk as [string, { kind: string }];
      got.push(payload.kind);
      if (payload.kind === 'skeleton') {
        // The whole point: we are holding the skeleton in hand while `slow`
        // is provably still blocked.
        expect(slowNodeFinished).toBe(false);
        release();
      }
    }

    expect(got).toEqual(['skeleton', 'content']);
  });
});
