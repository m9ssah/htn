import { timed } from './timed.js';
import type { Ctx, Node } from './types.js';

/**
 * The node runner: `timed()` plus a completion gate.
 *
 * `timed()` measures. This adds the one thing no individual node should have
 * to remember: **a node that returns normally on an aborted turn is not a
 * completed node.** Cancellation is cooperative (p19b) — a content source or
 * a client that never consults `signal` runs to the end and resolves
 * cleanly, and without this check the caller cannot tell a barge-in from a
 * finished generation. Rethrowing the abort reason here fixes it once, in
 * the seam, for every node including ones written later.
 *
 * It is deliberately NOT inside `timed()`: `timed()` is also what the CLI
 * wraps a single node in, where there is no turn to cancel, and the
 * distinction between "measured" and "turn-scoped" is worth keeping.
 *
 * The graph wrapper (`graph.ts`) catches what this throws and returns
 * normally, so an abort never reaches the LangGraph stream controller —
 * which would discard every patch already enqueued (p19c).
 */
export async function runNode<In, Out>(node: Node<In, Out>, input: In, ctx: Ctx): Promise<Out> {
  const out = await timed(node).run(input, ctx);
  ctx.signal.throwIfAborted();
  return out;
}
