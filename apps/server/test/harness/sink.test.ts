import { describe, expect, it } from 'vitest';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import type { SkeletonPatch } from '@jit/schema';

const patch: SkeletonPatch = { v: 1, templateId: 'summary_done', maxWidth: 480 };

describe('PatchSinkStore turn gating', () => {
  it('drops a patch from a sink whose turn is no longer current', () => {
    const store = createMemorySinkStore();
    const turn1 = store.forTurn('turn-1');
    turn1.emit(patch);

    store.forTurn('turn-2'); // advances "current" — turn1 is now stale
    turn1.emit(patch); // dropped

    expect(store.patches).toHaveLength(1);
  });

  it('keeps a patch emitted while its turn is current', () => {
    const store = createMemorySinkStore();
    const turn1 = store.forTurn('turn-1');
    turn1.emit(patch);

    expect(store.patches).toEqual([patch]);
  });
});

describe('PatchSink.emit is synchronous', () => {
  // The type-level assertion — `emit` returns `void`, not `Promise<void>` —
  // lives in contract.test-d.ts, so it is actually checked (vitest only
  // type-checks `*.test-d.ts` files, not this one).

  it('returns a plain value at runtime, not a thenable', () => {
    const store = createMemorySinkStore();
    const sink = store.forTurn('turn-1');
    const result = sink.emit(patch);

    expect(result).toBeUndefined();
  });
});
