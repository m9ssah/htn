import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { runNode } from './run-node.js';
import type { Ctx, FaultReason, Node } from './types.js';

/**
 * What a LangGraph node needs from the turn it is running in, and the
 * wrapper that keeps a failing node from taking the turn's already-emitted
 * patches down with it.
 *
 * Deliberately says nothing about templates, slots or patch shape: the
 * payload is opaque to everything in this file. The concrete graph — which
 * nodes, in what order, branching on what — is NOT here, because the node
 * set is being retargeted; this is the part of the wiring that survives that
 * change unaltered.
 */

export type TurnRuntime = {
  turnId: string;
  ctx: Ctx;
  /** Records a line in the buffered turn log. Synchronous, never I/O. */
  note(kind: string, data?: Record<string, unknown>): void;
  /**
   * The sink can only reach the consumer through `config.writer`, and
   * `config` exists only inside a node. Every node binds it on entry; it is
   * the same closure for the whole stream.
   */
  bindWriter(writer: ((chunk: unknown) => void) | undefined): void;
};

/**
 * Pulls the turn out of `config.configurable` and binds this stream's
 * writer. Every node calls this first.
 *
 * Both failures throw rather than degrading: a missing runtime is a wiring
 * bug, and a `writer` that is quietly `undefined` would make every patch of
 * the turn a silent no-op — constraint 5's exact failure. Neither can happen
 * after a patch has been emitted, so neither can cost a queued chunk.
 */
export function runtimeOf(config: LangGraphRunnableConfig): TurnRuntime {
  const turn = config.configurable?.turn as TurnRuntime | undefined;
  if (!turn) throw new Error('graph: config.configurable.turn is missing — build the config with startTurn()');
  turn.bindWriter(config.writer);
  return turn;
}

/** `aborted` is never passed in — `runGuarded` decides that one itself. */
export type CrashReason = Exclude<FaultReason, 'aborted'>;

export type Guarded<Out> = { ok: true; out: Out } | { ok: false; aborted: boolean };

/**
 * Runs one harness node and converts every exit into a value. **The only
 * thing that ever leaves this function is a return.**
 *
 * This, and not any individual node's own `try`, is what makes the
 * crash-under-lag guarantee hold. `p19c` measured that an error reaching the
 * LangGraph stream controller calls `controller.error()`, which resets the
 * queue and discards everything enqueued but not yet read: 6 writes before a
 * throw delivered 6/6 at 0ms consumer lag, 3/6 at 150ms, **2/6 at 300ms**.
 * `p19d` measured the fix — catch inside, return normally — at 6/6 for every
 * lag. A node written next week inherits that by being wrapped, without
 * having to know why.
 *
 * An abort is reported as a distinct fault reason, not as a crash: the turn
 * is over, and nothing is lost by stopping.
 *
 * ---
 *
 * **READ THIS BEFORE WIRING THE CONCRETE GRAPH.**
 *
 * `runGuarded` returning `{ ok: false }` does NOT stop the graph. It converts
 * a failure into a value precisely so the stream controller never sees an
 * exception — which means the node after the failed one runs anyway, on state
 * the failed node never produced. A `decide` that times out therefore lets
 * `policy`, `style` and the composer all run and each file its own fault, and
 * the turn log fills with four faults describing one failure.
 *
 * The concrete graph must route on it: carry a `halted` flag in the graph
 * state, set it wherever `!result.ok`, and add a conditional edge to `END`
 * after every node that can halt. That is not automatic and nothing here can
 * make it automatic.
 *
 * Reproduction, already in the tree: `test/harness/doubles.ts`'s
 * `twoNodeGraph` has no halt routing — abort or crash `first` and `second`
 * still runs. That is the behaviour to design around, not a bug in the
 * double.
 */
export async function runGuarded<In, Out>(
  node: Node<In, Out>,
  input: In,
  turn: TurnRuntime,
  reason: CrashReason,
): Promise<Guarded<Out>> {
  const t0 = turn.ctx.now();
  try {
    return { ok: true, out: await runNode(node, input, turn.ctx) };
  } catch (err) {
    const aborted = turn.ctx.signal.aborted;
    turn.ctx.telemetry({
      kind: 'fault',
      node: node.name,
      ms: turn.ctx.now() - t0,
      error: err,
      reason: aborted ? 'aborted' : reason,
    });
    return { ok: false, aborted };
  }
}
