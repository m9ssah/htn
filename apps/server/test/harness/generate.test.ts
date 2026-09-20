import { describe, expect, it } from 'vitest';
import { generate } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';

/**
 * `generate` calls `ctx.sink.emit(...)` per chunk (nodes.ts). Without this,
 * that call is exercised by every other test in this suite but never
 * verified — `createStubCtx` used to build its sink inline and discard the
 * handle, so nothing a node emitted was ever reachable again.
 */
describe('generate', () => {
  it('emits one patch per chunk into the sink', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);

    const chunks = await generate.run('cookies', ctx);

    expect(store.patches).toHaveLength(chunks.length);
    expect(store.patches.map((p) => ('interpretedAs' in p ? p.interpretedAs : undefined))).toEqual(chunks);
  });
});
