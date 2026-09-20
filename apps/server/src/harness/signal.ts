/**
 * An abortable sleep — the "do the right thing" helper `Ctx.signal` needs.
 *
 * Rejects as soon as `signal` aborts, instead of resolving on its own timer.
 * A node that `await`s this (rather than a bare `setTimeout`) stops as soon as
 * the turn is cancelled, which is the one thing that actually works per
 * `backend/probes/p19b_langgraph_cancel.mjs` — see `types.ts`'s `Ctx.signal`
 * doc for what does not.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(id);
      reject(signal.reason ?? new Error('aborted'));
    };
    // Removed on normal resolution too, not just on abort (`{ once: true }`
    // only covers the latter) — otherwise a turn with many chunks leaves one
    // listener per chunk on the signal for the rest of the turn.
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
