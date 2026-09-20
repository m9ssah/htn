import { describe, expect, it } from 'vitest';
import type { ThemeEnums } from '@jit/schema';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { polish } from '../../../src/harness/nodes/polish.js';
import { stubPolishSource } from '../../../src/harness/clients/polish.js';

/**
 * Agent 4 — the node that was named in the architecture and never built.
 *
 * Its absence is why every generated surface looked the same: with no raw
 * token pass, the four-palette enum table WAS the styling, which is the
 * lookup table CLAUDE.md says we are explicitly not building. These assert
 * the two things that make shipping it safe — unknown tokens are dropped,
 * and an illegible set is rejected whole rather than cherry-picked.
 */

const ctx = createStubCtx(new AbortController().signal);

const theme: ThemeEnums = {
  palette: 'slate',
  fontPairing: 'system',
  density: 'normal',
  radius: 'soft',
  motif: 'none',
};

const brief = { utterance: 'what temperature do i bake at', templateId: 'generic_answer', layout: 'stat_led', base: {} };

const run = (raw: unknown) => polish.run({ brief, theme, raw }, ctx);

describe('polish accepts a legible design', () => {
  it('passes a contrast-clean token set through', async () => {
    const result = await run({
      interpretedAs: 'warm oven',
      tokens: { '--jit-bg': '#100b06', '--jit-fg': '#fbf3e9', '--jit-accent': '#f0a154', '--jit-on-accent': '#1a1206' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.v).toBe(1);
    expect(result.patch.tokens['--jit-accent']).toBe('#f0a154');
    expect(result.patch.interpretedAs).toBe('warm oven');
  });

  it('the offline stub is itself legible — otherwise every offline turn silently tests only the reject path', async () => {
    const raw = await stubPolishSource.design(brief, new AbortController().signal);

    expect((await run(raw)).ok).toBe(true);
  });

  /**
   * A JSON-mode model returns `--jit-weight-display` and `--jit-scale` as
   * numbers far more often than as strings. Rejecting a valid answer over its
   * encoding would throw away the design.
   */
  it('accepts a numeric axis and stringifies it', async () => {
    const result = await run({
      tokens: { '--jit-bg': '#0b0d10', '--jit-fg': '#f2f5f7', '--jit-weight-display': 250, '--jit-scale': 1.05 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.tokens['--jit-weight-display']).toBe('250');
    expect(result.patch.tokens['--jit-scale']).toBe('1.05');
  });
});

describe('polish refuses what the device must not paint', () => {
  /**
   * The contrast policy: rejected WHOLE. Cherry-picking the passing tokens
   * would certify combinations that were never checked together.
   */
  it('rejects an illegible set entirely rather than keeping its good half', async () => {
    const result = await run({
      interpretedAs: 'low contrast',
      tokens: { '--jit-bg': '#111111', '--jit-fg': '#1a1a1a', '--jit-muted': '#151515' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fails AA');
    expect(result.failures?.length).toBeGreaterThan(0);
  });

  /**
   * `TokenSet` is a closed record, so an invented property would be written
   * to the root as a var nothing reads — failing silently, which is the class
   * of bug constraint 5 exists to prevent.
   */
  it('drops a token name that is not an axis', async () => {
    const result = await run({
      tokens: { '--jit-bg': '#0b0d10', '--jit-fg': '#f2f5f7', '--jit-vibe': 'cosy', 'color': 'red' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.patch.tokens)).toEqual(['--jit-bg', '--jit-fg']);
  });

  /**
   * Extent and density factor are LAYOUT, not looks. The composer already
   * sized every reservation against the panel it was given, so letting a
   * styling pass change them afterwards would move boxes the height budget
   * has already measured and approved.
   */
  it('refuses to let a styling pass change the layout', async () => {
    const result = await run({
      tokens: { '--jit-bg': '#0b0d10', '--jit-fg': '#f2f5f7', '--jit-maxw': '2000px', '--jit-density-f': '3' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.tokens['--jit-maxw']).toBeUndefined();
    expect(result.patch.tokens['--jit-density-f']).toBeUndefined();
  });

  it.each([
    ['nothing at all', {}],
    ['no tokens key', { interpretedAs: 'x' }],
    ['tokens that are not an object', { tokens: 'blue' }],
    ['only unknown names', { tokens: { '--jit-nope': '#fff' } }],
    ['empty values', { tokens: { '--jit-bg': '   ' } }],
  ])('reports "%s" as unusable rather than emitting an empty patch', async (_name, raw) => {
    const result = await run(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no usable tokens');
  });

  /**
   * A patch setting only a foreground is legible or not depending on the
   * ground underneath it, which comes from the enum base. Validating the
   * partial patch alone would certify a colour against a background nobody
   * ever put it on.
   */
  it('judges a partial patch against the enum base it will merge into', async () => {
    // Legible on its own terms, illegible once merged onto `slate`'s ground.
    const result = await run({ tokens: { '--jit-fg': '#10131a' } });

    expect(result.ok).toBe(false);
  });
});

describe('interpretedAs', () => {
  it('falls back to naming the surface when the designer did not say', async () => {
    const result = await run({ tokens: { '--jit-bg': '#0b0d10', '--jit-fg': '#f2f5f7' } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.interpretedAs).toBe('stat_led restyled');
  });
});
