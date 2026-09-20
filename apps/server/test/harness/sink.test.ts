import { describe, expect, it, vi } from 'vitest';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import type { SkeletonPatch } from '@jit/schema';

const patch: SkeletonPatch = { v: 1, templateId: 'summary_done', maxWidth: 480 };

describe('PatchSinkStore turn gating', () => {
  it('drops a patch from a sink whose turn is no longer current', () => {
    const store = createMemorySinkStore();
    const turn1 = store.beginTurn('turn-1');
    turn1.emit(patch);

    store.beginTurn('turn-2'); // advances the store — turn1 is now stale
    turn1.emit(patch); // dropped

    expect(store.patches).toHaveLength(1);
  });

  it('keeps a patch emitted while its turn is current', () => {
    const store = createMemorySinkStore();
    const turn1 = store.beginTurn('turn-1');
    turn1.emit(patch);

    expect(store.patches).toEqual([patch]);
  });

  /**
   * Gating on `turnId` equality has a bug: `beginTurn('t1')` called again
   * later would make `'t1' === 't1'` true again and resurrect the FIRST
   * `t1` sink — a dead sink coming back to life and landing a stale patch,
   * the exact failure this store exists to prevent. Gating on a monotonic
   * epoch instead means a reused id never comes back.
   */
  it('does not resurrect an earlier sink when a turn id is reused', () => {
    const store = createMemorySinkStore();
    const firstT1 = store.beginTurn('t1');
    store.beginTurn('t2');
    store.beginTurn('t1'); // a NEW turn that happens to reuse the id 't1'

    firstT1.emit(patch); // must stay dead — it is not the current 't1'

    expect(store.patches).toHaveLength(0);
  });

  it('calls onDrop with the turn id and patch when a stale sink emits', () => {
    const onDrop = vi.fn();
    const store = createMemorySinkStore(onDrop);
    const turn1 = store.beginTurn('turn-1');
    store.beginTurn('turn-2');

    turn1.emit(patch);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith('turn-1', patch);
    expect(store.patches).toHaveLength(0);
  });
});

describe('PatchSink.emit is synchronous', () => {
  // The type-level assertion — `emit` returns `void`, not `Promise<void>` —
  // lives in contract.test-d.ts, so it is actually checked (vitest only
  // type-checks `*.test-d.ts` files, not this one).

  it('returns a plain value at runtime, not a thenable', () => {
    const store = createMemorySinkStore();
    const sink = store.beginTurn('turn-1');
    const result = sink.emit(patch);

    expect(result).toBeUndefined();
  });
});
