import type { Ctx, Node } from './types.js';

/**
 * Wraps a node so every run is measured without the node opting in.
 *
 * Emits in a `finally`, with the error attached, so a node that throws or
 * times out still reports its timing — per the plan's Observability section,
 * that is the most interesting event in the log and the easiest to lose.
 */
export const timed = <In, Out>(node: Node<In, Out>): Node<In, Out> => ({
  ...node,
  async run(input: In, ctx: Ctx): Promise<Out> {
    const t0 = ctx.now();
    let error: unknown;
    let threw = false;
    try {
      return await node.run(input, ctx);
    } catch (e) {
      threw = true;
      error = e;
      throw e;
    } finally {
      ctx.telemetry({ node: node.name, ms: ctx.now() - t0, ...(threw ? { error } : {}) });
    }
  },
});
