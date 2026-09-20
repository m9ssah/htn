import { describe, expectTypeOf, it } from 'vitest';
import type { PatchSink } from '../../src/harness/types.js';

/**
 * `emit` must return `void`, not `Promise<void>`. TypeScript still allows
 * `await sink.emit(p)` — `await` on `void` is legal — but an awaited `void`
 * costs one microtask, never I/O (see `types.ts`'s `PatchSink` doc for why
 * that's the property `p19c`/`p19d` actually require).
 */
describe('PatchSink.emit', () => {
  it('returns void, not a Promise', () => {
    expectTypeOf<ReturnType<PatchSink['emit']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<PatchSink['emit']>>().not.toEqualTypeOf<Promise<void>>();
  });
});
