import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@jit/renderer';
import { decide } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';

/**
 * `decide` builds the naive `SkeletonPatch`/`StylePatch` straight from what
 * Jev said — it does NOT decide whether to apply `templateId` on
 * refine/correct/select (that's `policy`, P2). This only proves the shape
 * `decide` hands `policy`, against the deterministic stub client.
 */
describe('decide', () => {
  it('builds a SkeletonPatch + StylePatch from the Jev answer, plus the raw answer', async () => {
    const ctx = createStubCtx(new AbortController().signal);
    const state = { utterance: 'what should I make tonight', currentTemplate: null, taskState: '' };

    const result = await decide.run(state, ctx);

    expect(result.skeleton).toEqual({
      v: 1,
      templateId: 'generic_answer',
      maxWidth: TEMPLATES.generic_answer.maxWidth,
    });
    expect(result.style).toEqual({
      v: 1,
      theme: { palette: 'slate', fontPairing: 'system', density: 'normal', radius: 'soft', motif: 'none' },
    });
    expect(result.jev.route.value).toBe('query');
    expect(result.jev.templateId.confidence).toBe(0.5);
  });
});
