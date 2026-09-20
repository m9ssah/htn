import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { ContentUpdateV2, SurfaceUpdate } from '@jit/schema';
import { runGuarded, runtimeOf, type TurnRuntime } from '../../src/harness/graph-runtime.js';
import type { PatchStream, TurnDeps } from '../../src/harness/turn.js';
import { stubContentSource } from '../../src/harness/clients/content.js';
import { stubJevClient } from '../../src/harness/clients/jev.js';
import type { Ctx, Node } from '../../src/harness/types.js';

/**
 * Doubles for the P4 wiring tests. No network, no subprocess, no fixtures.
 *
 * The graphs here are deliberately synthetic. The properties under test —
 * a patch reaching the consumer mid-graph, a crash under a lagging consumer
 * losing nothing, zero patches after a barge-in — are properties of the
 * transport and of `runGuarded`, and proving them needs nodes that fail in
 * ways no production node does.
 */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A recognisable, schema-valid payload. The contents are irrelevant to the
 * wiring — what matters is that it is a real `ContentUpdateV2` and not a
 * hand-shaped object, so a transport that accidentally started inspecting
 * the payload would be caught by the schema rather than by luck.
 *
 * `ContentUpdateV2` rather than `StructureUpdateV2` on purpose: the latter
 * carries a `SurfaceSpec` with its own zod schema, and a wrong literal there
 * fails silently here and loudly on the device.
 */
export const patch = (n: number): ContentUpdateV2 => ({
  v: 2,
  stage: 'content',
  requestId: 'test-request',
  generationId: 'test-generation',
  complete: false,
  values: { probe: { n } },
});

export const patchLabel = (p: SurfaceUpdate): string => {
  const n = (p as ContentUpdateV2).values?.probe?.n;
  return typeof n === 'number' ? `patch ${n}` : JSON.stringify(p);
};

const State = Annotation.Root({ step: Annotation<number> });

/** Wraps a single harness `Node` in a one-node graph through the real wrapper. */
export function oneNodeGraph(node: Node<void, void>): PatchStream {
  const graph = new StateGraph(State)
    .addNode('only', async (_state, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      const result = await runGuarded(node, undefined, turn, 'node-crashed');
      if (!result.ok) turn.note('node-failed', { aborted: result.aborted });
      return { step: 1 };
    })
    .addEdge(START, 'only')
    .addEdge('only', END)
    .compile();
  return graph as unknown as PatchStream;
}

/** Two nodes in sequence, so "mid-graph" is a meaningful thing to assert. */
export function twoNodeGraph(first: Node<void, void>, second: Node<void, void>): PatchStream {
  const step = (name: string, node: Node<void, void>) => async (
    _state: { step: number },
    config: LangGraphRunnableConfig,
  ): Promise<{ step: number }> => {
    const turn = runtimeOf(config);
    const result = await runGuarded(node, undefined, turn, 'node-crashed');
    if (!result.ok) turn.note(`${name}-failed`, { aborted: result.aborted });
    return { step: 1 };
  };

  const graph = new StateGraph(State)
    .addNode('first', step('first', first))
    .addNode('second', step('second', second))
    .addEdge(START, 'first')
    .addEdge('first', 'second')
    .addEdge('second', END)
    .compile();
  return graph as unknown as PatchStream;
}

/** A node that emits `count` patches, sleeping `gapMs` between them, then throws. */
export function emitThenThrow(count: number, gapMs: number, name = 'crasher'): Node<void, void> {
  return {
    name,
    async run(_input, ctx: Ctx): Promise<void> {
      for (let i = 1; i <= count; i += 1) {
        if (gapMs) await sleep(gapMs);
        ctx.sink.emit(patch(i));
      }
      throw new Error(`${name}: exploded after ${count} patches`);
    },
  };
}

/**
 * A node that ignores `ctx.signal` entirely — the p19b failure mode, and the
 * only kind of node that can prove the sink's own abort gate does anything.
 * `attempts` counts every `emit` it tried, including the dropped ones.
 */
export function signalIgnoringEmitter(count: number, gapMs: number, attempts: number[]): Node<void, void> {
  return {
    name: 'leaky',
    async run(_input, ctx: Ctx): Promise<void> {
      for (let i = 1; i <= count; i += 1) {
        await sleep(gapMs);
        attempts.push(i);
        ctx.sink.emit(patch(i));
      }
    },
  };
}

export function emitter(count: number, gapMs = 0, name = 'emitter'): Node<void, void> {
  return {
    name,
    async run(_input, ctx: Ctx): Promise<void> {
      for (let i = 1; i <= count; i += 1) {
        if (gapMs) await sleep(gapMs);
        ctx.sink.emit(patch(i));
      }
    },
  };
}

/**
 * `startTurn` deps with the stub clients and no log file. The graph is
 * always supplied per test; `extra` overrides anything else.
 */
export function deps(graph: PatchStream, extra: Partial<TurnDeps> = {}): TurnDeps {
  return { graph, jev: stubJevClient, content: stubContentSource, logPath: null, ...extra };
}

export type { TurnRuntime };
