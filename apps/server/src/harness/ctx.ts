import type { Ctx, PatchSinkStore } from './types.js';
import { stubJevClient } from './clients/jev.js';
import { stubContentSource } from './clients/content.js';
import { stubContentModel } from './clients/content-model.js';
import { stubResearchClient } from './clients/research.js';
import { createMemorySinkStore } from './clients/sink.js';

/**
 * A `Ctx` wired to the stub clients — no network, no key, deterministic.
 *
 * `store` defaults to a fresh, throwaway one so callers that don't care what
 * a node emits (the CLI) don't have to think about it. A test that DOES care
 * — asserting a node's patches actually landed — passes its own
 * `createMemorySinkStore()` and reads `.patches` off it afterward; otherwise
 * whatever a node emits would be unreachable once `createStubCtx` returns.
 */
export function createStubCtx(signal: AbortSignal, store: PatchSinkStore = createMemorySinkStore()): Ctx {
  return {
    jev: stubJevClient,
    content: stubContentSource,
    contentModel: stubContentModel,
    fetch: stubResearchClient,
    sink: store.beginTurn('stub-turn'),
    signal,
    now: () => performance.now(),
    telemetry: () => {},
  };
}
