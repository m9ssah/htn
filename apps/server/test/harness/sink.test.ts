import { describe, expect, it, vi } from 'vitest';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import type { StyleUpdateV1 } from '@jit/schema';

const patch: StyleUpdateV1 = {
  v: 1,
  stage: 'style',
  theme: { palette: 'slate', fontPairing: 'system', density: 'normal', radius: 'soft', motif: 'none' },
};

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

  it('calls onDrop with the turn id, patch and reason when a stale sink emits', () => {
    const onDrop = vi.fn();
    const store = createMemorySinkStore(onDrop);
    const turn1 = store.beginTurn('turn-1');
    store.beginTurn('turn-2');

    turn1.emit(patch);

    expect(onDrop).toHaveBeenCalledTimes(1);
    // P4 added the third argument: three different conditions close a sink
    // and the turn log has to say which one fired, or "nothing painted" is
    // indistinguishable from "the wrong turn painted".
    expect(onDrop).toHaveBeenCalledWith('turn-1', patch, 'stale-turn');
    expect(store.patches).toHaveLength(0);
  });
});

describe('PatchSink: the abort gate', () => {
  /**
   * The epoch alone leaves a hole: it only advances when the NEXT turn
   * begins, and a barge-in need not be followed by another turn at all. For
   * that entire window an aborted turn's sink was still live — measured in
   * P5, where a content source that ignores the signal landed two patches
   * after an abort.
   */
  it('stops emitting the instant the turn signal aborts, with no later turn involved', () => {
    const onDrop = vi.fn();
    const store = createMemorySinkStore(onDrop);
    const controller = new AbortController();
    const sink = store.beginTurn('turn-1', controller.signal);

    sink.emit(patch);
    controller.abort(new Error('barge-in'));
    sink.emit(patch);
    sink.emit(patch);

    expect(store.patches).toHaveLength(1);
    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(onDrop).toHaveBeenLastCalledWith('turn-1', patch, 'aborted');
  });

  it('close() silences a turn that neither aborted nor was superseded', () => {
    const onDrop = vi.fn();
    const store = createMemorySinkStore(onDrop);
    const sink = store.beginTurn('turn-1');

    sink.emit(patch);
    sink.close();
    sink.emit(patch);

    expect(store.patches).toHaveLength(1);
    expect(onDrop).toHaveBeenCalledWith('turn-1', patch, 'closed');
  });

  it('a signal that aborts before the turn starts yields no patches at all', () => {
    const store = createMemorySinkStore();
    const sink = store.beginTurn('turn-1', AbortSignal.abort());
    sink.emit(patch);
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
