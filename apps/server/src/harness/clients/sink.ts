import type { Patch } from '@jit/schema';
import type { PatchSink, PatchSinkStore } from '../types.js';

/** The real transport (websocket to the device) is P4's job. Documented stub. */
export const realPatchSinkStore: PatchSinkStore = {
  beginTurn(): PatchSink {
    throw new Error('realPatchSinkStore: not implemented until P4 (websocket transport)');
  },
};

/**
 * In-memory, synchronous. `patches` is exposed for tests to inspect what
 * actually landed after turn-gating.
 *
 * Gates on a monotonic epoch, not on `turnId` equality. Gating on the id
 * itself has a bug: calling `beginTurn('t1')` twice — once now, once again
 * later — would make the *first* call's sink current again, because
 * `'t1' === 't1'`. That resurrects a sink that already ended, which is
 * exactly the stale-patch failure this store exists to prevent. The epoch
 * only ever moves forward, so a reused `turnId` never comes back to life.
 * `turnId` still goes to `onDrop` — it's the label, not the gate.
 */
export function createMemorySinkStore(
  onDrop?: (turnId: string, patch: Patch) => void,
): PatchSinkStore & { readonly patches: readonly Patch[] } {
  let epoch = 0;
  const patches: Patch[] = [];
  return {
    get patches(): readonly Patch[] {
      return patches;
    },
    beginTurn(turnId: string): PatchSink {
      const myEpoch = ++epoch;
      return {
        emit(patch: Patch): void {
          if (myEpoch !== epoch) {
            onDrop?.(turnId, patch); // stale turn — dropped, not queued
            return;
          }
          patches.push(patch);
        },
      };
    },
  };
}
