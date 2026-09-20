import type { Patch } from '@jit/schema';
import type { PatchSink, PatchSinkStore } from '../types.js';

/**
 * The real transport-side store: every patch a turn emits goes straight to
 * `deliver`, which in P4 is the LangGraph `config.writer` bridge (`turn.ts`)
 * and later, unchanged, a websocket `send`. It is `createGatedSinkStore`
 * with nothing added — the gate, the signal binding and the drop reporting
 * are the transport's requirements, not the memory store's, which is why
 * they live in the shared factory rather than being retrofitted onto one
 * caller.
 *
 * `deliver` MUST be synchronous. An `await` between `emit` and delivery
 * recreates the consumer lag that discards queued chunks when a node errors
 * (p19c: 2/6 delivered at 300ms/chunk).
 */
export function createRealPatchSinkStore(
  deliver: (patch: Patch, turnId: string) => void,
  onDrop?: (turnId: string, patch: Patch, reason: DropReason) => void,
): GatedSinkStore {
  return createGatedSinkStore(deliver, onDrop);
}

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
  onDrop?: (turnId: string, patch: Patch, reason?: DropReason) => void,
): GatedSinkStore & { readonly patches: readonly Patch[] } {
  const patches: Patch[] = [];
  const store = createGatedSinkStore((patch) => patches.push(patch), onDrop);
  return {
    get patches(): readonly Patch[] {
      return patches;
    },
    beginTurn: (turnId: string, signal?: AbortSignal): GatedSink => store.beginTurn(turnId, signal),
  };
}

/**
 * Why a patch never reached `deliver`. All three are reportable, never
 * silent (constraint 5): a node still emitting after its turn ended is a
 * real bug, and a silent no-op turns a visible one into an invisible one.
 */
export type DropReason = 'stale-turn' | 'aborted' | 'closed';

/**
 * A turn's sink, plus the one thing a *graph* turn needs that an in-memory
 * one does not: an explicit `close()`, for ending a turn that no later turn
 * has superseded and no signal cancelled.
 */
export type GatedSink = PatchSink & { close(): void };

export interface GatedSinkStore extends PatchSinkStore {
  beginTurn(turnId: string, signal?: AbortSignal): GatedSink;
}

/**
 * The gate itself, factored out so the in-memory store (what tests drive)
 * and the real transport store cannot drift apart on the one piece of logic
 * a prior review already had to fix once.
 *
 * THREE conditions close a sink, and they are not redundant:
 *
 * - **epoch** — a later `beginTurn` has superseded this turn. Monotonic, not
 *   `turnId` equality: gating on the id resurrected a dead sink when an id
 *   was reused (`t1 -> t2 -> t1`), which is the exact stale-patch failure
 *   this store exists to prevent.
 * - **signal** — the turn was aborted. The epoch alone leaves an unbounded
 *   window open here: it only advances when the NEXT turn begins, and a
 *   barge-in need not be followed by another turn at all. Measured in P5 —
 *   with a content source that ignores the signal, two patches landed after
 *   an abort. Binding the signal closes that window for every node at once,
 *   including nodes that never consult `Ctx.signal` themselves (p19b
 *   measured that such nodes keep running to completion).
 * - **close()** — the turn runner is done with this sink.
 *
 * `deliver` is called synchronously and must stay synchronous: an `await`
 * between `emit` and delivery recreates the consumer lag that loses writes
 * when a node errors (p19c: 2/6 delivered at 300ms/chunk).
 */
export function createGatedSinkStore(
  deliver: (patch: Patch, turnId: string) => void,
  onDrop?: (turnId: string, patch: Patch, reason: DropReason) => void,
): GatedSinkStore {
  let epoch = 0;
  return {
    beginTurn(turnId: string, signal?: AbortSignal): GatedSink {
      const myEpoch = ++epoch;
      let closed = false;
      return {
        emit(patch: Patch): void {
          const reason: DropReason | null = closed
            ? 'closed'
            : signal?.aborted
              ? 'aborted'
              : myEpoch !== epoch
                ? 'stale-turn'
                : null;
          if (reason) {
            onDrop?.(turnId, patch, reason); // dropped, not queued — and reported
            return;
          }
          deliver(patch, turnId);
        },
        close(): void {
          closed = true;
        },
      };
    },
  };
}
