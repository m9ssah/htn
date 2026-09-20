import { describe, expect, it } from 'vitest';
import { runNode } from '../../src/harness/run-node.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import type { Ctx, Event, Node } from '../../src/harness/types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('runNode: the completion gate', () => {
  /**
   * Cancellation is cooperative (p19b). A node whose source never consults
   * `signal` runs to the end and resolves cleanly, so without this gate a
   * caller cannot tell a barge-in from a finished generation — the turn
   * would look successful and the next one would be sequenced behind it.
   */
  it('rejects with the abort reason when a node returns normally on an aborted turn', async () => {
    const controller = new AbortController();
    const ctx = createStubCtx(controller.signal);

    const oblivious: Node<void, void> = {
      name: 'oblivious',
      async run(): Promise<void> {
        await sleep(20); // never looks at ctx.signal
      },
    };

    const reason = new Error('barge-in: user spoke again');
    setTimeout(() => controller.abort(reason), 5);

    await expect(runNode(oblivious, undefined, ctx)).rejects.toThrow('barge-in: user spoke again');
  });

  it('returns the node output untouched when the turn was not cancelled', async () => {
    const ctx = createStubCtx(new AbortController().signal);
    const node: Node<number, number> = { name: 'double', async run(n): Promise<number> { return n * 2; } };
    await expect(runNode(node, 21, ctx)).resolves.toBe(42);
  });

  it('still measures a node that throws — the timing wrapper is underneath', async () => {
    const ctx = createStubCtx(new AbortController().signal);
    const events: Event[] = [];
    ctx.telemetry = (e) => events.push(e);
    const boom: Node<void, void> = {
      name: 'boom',
      async run(): Promise<void> {
        throw new Error('boom');
      },
    };
    await expect(runNode(boom, undefined, ctx)).rejects.toThrow('boom');
    expect(events).toHaveLength(1);
    expect(events[0]?.node).toBe('boom');
    expect(events[0]?.error).toBeInstanceOf(Error);
  });

  it('a node that emits after the turn aborted lands nothing, and the attempt is reported', async () => {
    const controller = new AbortController();
    const dropped: string[] = [];
    const store = createMemorySinkStore((_turnId, _patch, reason) => dropped.push(reason ?? 'unknown'));
    const ctx: Ctx = { ...createStubCtx(controller.signal), sink: store.beginTurn('t1', controller.signal) };

    const leaky: Node<void, void> = {
      name: 'leaky',
      async run(_input, c: Ctx): Promise<void> {
        c.sink.emit({ v: 1, slots: {} });
        await sleep(20);
        c.sink.emit({ v: 1, slots: {} });
      },
    };

    setTimeout(() => controller.abort(new Error('barge-in')), 5);
    await expect(runNode(leaky, undefined, ctx)).rejects.toThrow('barge-in');

    expect(store.patches).toHaveLength(1);
    expect(dropped).toEqual(['aborted']);
  });
});
