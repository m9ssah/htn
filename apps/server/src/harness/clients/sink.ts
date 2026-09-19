import { appendFileSync } from 'node:fs';
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

/**
 * Buffers patches in memory and writes one JSONL file per `flush()` call —
 * this is the sink-side "replay" implementation: a recorded turn log that a
 * later phase can read back as a fixture.
 *
 * `emit` itself does no I/O, per the measured requirement that it stay
 * synchronous (`types.ts`'s `PatchSink` doc). The caller is responsible for
 * calling `flush()` in a `finally`, so an abort or crash still writes what was
 * buffered.
 */
export function createRecordingSinkStore(filePath: string): PatchSinkStore {
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    appendFileSync(filePath, buffer.join('\n') + '\n');
    buffer = [];
  };
  return {
    forTurn(turnId: string): PatchSink & { flush(): void } {
      current = turnId;
      return {
        emit(patch: Patch): void {
          if (turnId !== current) return;
          buffer.push(JSON.stringify({ turnId, patch }));
        },
        flush,
      };
    },
  };
}
