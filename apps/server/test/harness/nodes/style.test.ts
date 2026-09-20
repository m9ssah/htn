import { describe, expect, it } from 'vitest';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { style } from '../../../src/harness/nodes/style.js';
import type { JevAnswer } from '../../../src/harness/types.js';

const ctx = createStubCtx(new AbortController().signal);

function jevWith(wantsStyleChange: boolean | undefined): JevAnswer {
  return {
    route: { value: 'refine', confidence: 1, distribution: {} },
    templateId: { value: 'item_detail', confidence: 1, distribution: {} },
    theme: {
      palette: { value: 'contrast', confidence: 1, distribution: {} },
      fontPairing: { value: 'mono', confidence: 1, distribution: {} },
      density: { value: 'compact', confidence: 1, distribution: {} },
      radius: { value: 'sharp', confidence: 1, distribution: {} },
      motif: { value: 'none', confidence: 1, distribution: {} },
    },
    ...(wantsStyleChange !== undefined
      ? { wantsStyleChange: { value: wantsStyleChange, probability: wantsStyleChange ? 0.9 : 0.1, confidence: 0.8 } }
      : {}),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/**
 * The gate p14 measured is missing: Jev picks a theme on EVERY utterance, so
 * `style` must not emit one unless `wantsStyleChange` (the noul) says so —
 * and must not look at `route` to decide that (Q3 in the P2 hand-off:
 * orthogonal, no special-casing).
 */
describe('style', () => {
  it('emits a StylePatch (enums only) when the gate is true', async () => {
    const result = await style.run(jevWith(true), ctx);

    expect(result).toEqual({
      v: 1,
      theme: { palette: 'contrast', fontPairing: 'mono', density: 'compact', radius: 'sharp', motif: 'none' },
    });
  });

  it('emits nothing when the gate is false — p14s "show me the whole recipe" case', async () => {
    const result = await style.run(jevWith(false), ctx);

    expect(result).toBeNull();
  });

  it('emits nothing when wantsStyleChange is absent (safe default — true of all 4 recorded fixtures, which predate it)', async () => {
    const result = await style.run(jevWith(undefined), ctx);

    expect(result).toBeNull();
  });

  it('is orthogonal to route: a refine utterance with the gate false still emits nothing', async () => {
    const jev = jevWith(false);
    expect(jev.route.value).toBe('refine');

    const result = await style.run(jev, ctx);

    expect(result).toBeNull();
  });

  it('never includes a raw token — only ThemeEnums values already in the finite sets', async () => {
    const result = await style.run(jevWith(true), ctx);

    expect(result?.theme.palette).toBe('contrast');
    expect(typeof result?.theme.palette).toBe('string');
  });
});
