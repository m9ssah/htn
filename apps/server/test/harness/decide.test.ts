import { describe, expect, it } from 'vitest';
import { decide } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';

/**
 * `decide` builds the naive `StylePatch` straight from what Jev said — it does
 * NOT decide whether to apply `templateId` on refine/correct/select (that's
 * `policy`), and it no longer builds a skeleton: structure is a `SurfaceSpec`
 * from a `StructureComposer` now, not a 1-of-8 template selection
 * (docs/adr/0001). `templateId` survives as the question that picks which
 * candidate pool / projection a turn uses. Deterministic stub client.
 */
describe('decide', () => {
  it('builds a StylePatch from the Jev answer, plus the raw answer', async () => {
    const ctx = createStubCtx(new AbortController().signal);
    const state = { utterance: 'what should I make tonight', currentTemplate: null, taskState: '' };

    const result = await decide.run(state, ctx);

    expect(result).not.toHaveProperty('skeleton');
    expect(result.style).toEqual({
      v: 1,
      theme: { palette: 'slate', fontPairing: 'system', density: 'normal', radius: 'soft', motif: 'none' },
    });
    expect(result.jev.route.value).toBe('query');
    expect(result.jev.templateId.value).toBe('generic_answer');
    expect(result.jev.templateId.confidence).toBe(0.5);
  });
});
