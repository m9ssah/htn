import { describe, expect, it } from 'vitest';
import { timed } from '../../src/harness/timed.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import type { Event, Node } from '../../src/harness/types.js';

/**
 * A node that throws or times out is the most interesting event in the log
 * and the easiest to lose (docs/orchestration-plan.md, Observability). These
 * prove `timed` reports on both paths, not just the happy one.
 */
describe('timed', () => {
  it('reports ms on success', async () => {
    const node: Node<string, string> = { name: 'ok', async run(input) { return input; } };
    const events: Event[] = [];
    const ctx = createStubCtx(new AbortController().signal);
    ctx.telemetry = (e) => events.push(e);

    const out = await timed(node).run('hi', ctx);

    expect(out).toBe('hi');
    expect(events).toHaveLength(1);
    expect(events[0]?.node).toBe('ok');
    expect(events[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(events[0]?.error).toBeUndefined();
  });

  it('reports ms and the error when the node throws', async () => {
    const boom = new Error('node blew up');
    const node: Node<string, string> = {
      name: 'failing',
      async run() {
        throw boom;
      },
    };
    const events: Event[] = [];
    const ctx = createStubCtx(new AbortController().signal);
    ctx.telemetry = (e) => events.push(e);

    await expect(timed(node).run('hi', ctx)).rejects.toThrow(boom);

    expect(events).toHaveLength(1);
    expect(events[0]?.node).toBe('failing');
    expect(events[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(events[0]?.error).toBe(boom);
  });
});
