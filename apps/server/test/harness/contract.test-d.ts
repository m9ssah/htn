import { describe, expectTypeOf, it } from 'vitest';
import type { PatchSink } from '../../src/harness/types.js';

/**
 * `emit` must return `void`, not `Promise<void>` — encoded in the type so a
 * later phase physically cannot `await` per patch (see `types.ts`'s
 * `PatchSink` doc for why: an `await` here recreates the exact consumer lag
 * that `p19c`/`p19d` measured discarding buffered chunks on a throw).
 */
describe('PatchSink.emit', () => {
  it('returns void, not a Promise', () => {
    expectTypeOf<ReturnType<PatchSink['emit']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<PatchSink['emit']>>().not.toEqualTypeOf<Promise<void>>();
  });
});
