import type { Patch } from '@jit/schema';
import type { PatchSink, PatchSinkStore } from '../types.js';

/** The real transport (websocket to the device) is P4's job. Documented stub. */
export const realPatchSinkStore: PatchSinkStore = {
  forTurn(): PatchSink {
    throw new Error('realPatchSinkStore: not implemented until P4 (websocket transport)');
  },
};

/**
 * In-memory, synchronous. `patches` is exposed for tests to inspect what
 * actually landed after turn-gating.
 */
export function createMemorySinkStore(): PatchSinkStore & { readonly patches: readonly Patch[] } {
  let current: string | null = null;
  const patches: Patch[] = [];
  return {
    get patches(): readonly Patch[] {
      return patches;
    },
    forTurn(turnId: string): PatchSink {
      current = turnId;
      return {
        emit(patch: Patch): void {
          if (turnId !== current) return; // a later forTurn moved "current" on
          patches.push(patch);
        },
      };
    },
  };
}
