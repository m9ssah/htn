import type { Ctx } from './types.js';
import { stubJevClient } from './clients/jev.js';
import { stubContentSource } from './clients/content.js';
import { createMemorySinkStore } from './clients/sink.js';

/** A `Ctx` wired to the stub clients — no network, no key, deterministic. */
export function createStubCtx(signal: AbortSignal, turnId = 'stub-turn'): Ctx {
  return {
    jev: stubJevClient,
    content: stubContentSource,
    sink: createMemorySinkStore().forTurn(turnId),
    signal,
    now: () => performance.now(),
    telemetry: () => {},
  };
}
