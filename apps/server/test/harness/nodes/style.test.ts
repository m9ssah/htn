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
 *
 * The gate now has one exception, asserted at the bottom: a GENERATED
 * surface is styled unconditionally, because it did not exist a moment ago
 * and so there is no established look to disturb. The gate's reasoning was
 * always about surfaces that persist.
 */
describe('style', () => {
  it('emits a StylePatch (enums only) when the gate is true', async () => {
    const result = await style.run({ jev: jevWith(true) }, ctx);

    expect(result).toEqual({
      v: 1,
      theme: { palette: 'contrast', fontPairing: 'mono', density: 'compact', radius: 'sharp', motif: 'none' },
    });
  });

  it('emits nothing when the gate is false — p14s "show me the whole recipe" case', async () => {
    const result = await style.run({ jev: jevWith(false) }, ctx);

    expect(result).toBeNull();
  });

  it('emits nothing when wantsStyleChange is absent (safe default — true of all 4 recorded fixtures, which predate it)', async () => {
    const result = await style.run({ jev: jevWith(undefined) }, ctx);

    expect(result).toBeNull();
  });

  it('is orthogonal to route: a refine utterance with the gate false still emits nothing', async () => {
    const jev = jevWith(false);
    expect(jev.route.value).toBe('refine');

    const result = await style.run({ jev }, ctx);

    expect(result).toBeNull();
  });

  it('never includes a raw token — only ThemeEnums values already in the finite sets', async () => {
    const result = await style.run({ jev: jevWith(true) }, ctx);

    expect(result?.theme.palette).toBe('contrast');
    expect(typeof result?.theme.palette).toBe('string');
  });

  /**
   * The reported defect: every generated answer painted in the identical
   * bootstrap theme, so the device looked like a chatbot with one skin. The
   * gate was doing that — Jev had chosen a theme for the utterance and
   * `style` threw it away because the user had not asked to be restyled.
   */
  it('styles a GENERATED surface even with the gate false — a new answer has no look to disturb', async () => {
    const result = await style.run({ jev: jevWith(false), generated: true }, ctx);

    expect(result).toEqual({
      v: 1,
      theme: { palette: 'contrast', fontPairing: 'mono', density: 'compact', radius: 'sharp', motif: 'none' },
    });
  });

  it('still emits nothing for a PROJECTED surface with the gate false — the recipe must not restyle mid-bake', async () => {
    const result = await style.run({ jev: jevWith(false), generated: false }, ctx);

    expect(result).toBeNull();
  });
});
