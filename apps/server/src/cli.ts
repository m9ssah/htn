import { NODES } from './harness/nodes.js';
import { timed } from './harness/timed.js';
import { createStubCtx } from './harness/ctx.js';
import type { Event } from './harness/types.js';

/**
 * Runs ONE node alone against stub clients. Proves the harness seam without
 * LangGraph, without a network call, without Jev.
 *
 *   npm run node -- decide "make it bigger"
 */
const [nodeName, ...rest] = process.argv.slice(2);
const node = nodeName ? NODES[nodeName] : undefined;

if (!node) {
  console.error(`Unknown node: ${nodeName ?? '(none given)'}`);
  console.error(`Available nodes: ${Object.keys(NODES).join(', ')}`);
  process.exit(1);
}

const input = rest.join(' ');
const controller = new AbortController();
const events: Event[] = [];
const ctx = createStubCtx(controller.signal);
ctx.telemetry = (e) => events.push(e);

try {
  const output = await timed(node).run(input, ctx);
  console.log(JSON.stringify(output, null, 2));
} finally {
  // `timed` reports on the throw path too — print the ms here as well, or a
  // failing run tells you nothing about how long it took to fail.
  const timing = events.at(-1);
  console.log(`${timing?.ms.toFixed(1) ?? '?'}ms`);
}
