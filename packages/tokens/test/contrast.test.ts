import { describe, expect, it } from 'vitest';
import type { ThemeEnums, TokenSet } from '@jit/schema';
import {
  AA_NORMAL,
  PALETTES,
  applyPolish,
  checkContrast,
  contrastRatio,
  parseColor,
  resolve,
} from '@jit/tokens';

const theme = (overrides: Partial<ThemeEnums> = {}): ThemeEnums => ({
  palette: 'slate',
  fontPairing: 'system',
  density: 'normal',
  radius: 'soft',
  motif: 'none',
  ...overrides,
});

describe('parseColor', () => {
  it('reads the notations agent 4 actually emits', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#4ade80')).toEqual({ r: 74, g: 222, b: 128 });
    expect(parseColor('#4ade80ff')).toEqual({ r: 74, g: 222, b: 128 });
    expect(parseColor('rgb(74, 222, 128)')).toEqual({ r: 74, g: 222, b: 128 });
    expect(parseColor('rgba(74 222 128 / 0.5)')).toEqual({ r: 74, g: 222, b: 128 });
  });

  it('returns null rather than guessing', () => {
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(parseColor('var(--something)')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    expect(contrastRatio({ r: 20, g: 20, b: 20 }, { r: 20, g: 20, b: 20 })).toBeCloseTo(1, 5);
    // #767676 on white is the canonical "just passes AA" grey.
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 })).toBeGreaterThan(
      AA_NORMAL,
    );
  });
});

describe('checkContrast', () => {
  it('passes every palette in the enum table on all six pairs', () => {
    // The base exists to cover agent 4's latency. If it is unreadable, the user
    // stares at an inaccessible surface for up to two seconds on an
    // accessibility tool — so the table itself is held to AA, not just polish.
    for (const palette of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      const report = checkContrast(resolve(theme({ palette })), {
        surfaces: ['bg', 'surface', 'accent-soft'],
      });
      expect(report.checks, palette).toHaveLength(6);
      expect(report, palette).toMatchObject({ pass: true });
    }
  });

  it('catches a bad fg-on-accent-soft, the pairing Badge and Alert actually use', () => {
    // fg-on-accent-soft is the only accent-soft pair — see ContrastPair's doc
    // comment for why there is no accent-on-accent-soft. slate's real accent
    // (#6d5cf6) measured 3.63:1 against its real accentSoft (#1a1b30) when
    // Badge used to render accent-colored text there; no accentSoft value
    // could fix that (ceiling 4.512:1 even at pure black). The actual fix was
    // moving Badge's text to fg in renderer.css, which is why this test checks
    // fg-on-accent-soft rather than the pairing that used to fail.
    const base = resolve(theme({ palette: 'slate' }));
    const failing = { ...base, '--jit-fg': '#4a4d5c', '--jit-accent-soft': '#1a1b30' };
    const report = checkContrast(failing, { surfaces: ['accent-soft'] });
    const check = report.checks.find((c) => c.pair === 'fg-on-accent-soft');
    expect(report.pass).toBe(false);
    expect(check).toMatchObject({ pass: false });
    expect(check?.ratio).toBeLessThan(AA_NORMAL);
  });

  it('only checks the accent-soft pair when a template opts in', () => {
    // accent-soft is a component ground (Badge, Alert), not a page ground —
    // unlike on-accent-on-accent, it must NOT be forced on templates that never
    // paint on it, or a token set with an unrelated dark accent-soft would fail
    // a template that has no Badge or Alert to actually render on it.
    const withoutIt = checkContrast(resolve(theme()), { surfaces: [] });
    expect(withoutIt.checks.map((c) => c.pair)).toEqual(['on-accent-on-accent']);

    const withIt = checkContrast(resolve(theme()), { surfaces: ['accent-soft'] });
    expect(withIt.checks.map((c) => c.pair).sort()).toEqual(
      ['fg-on-accent-soft', 'on-accent-on-accent'].sort(),
    );
  });

  it('fails a deliberately low-contrast token set and says by how much', () => {
    const tokens = resolve(theme());
    const bad: TokenSet = {
      ...tokens,
      '--jit-bg': '#3a3a3a',
      '--jit-surface': '#3a3a3a',
      '--jit-fg': '#4a4a4a',
      '--jit-muted': '#454545',
    };

    const report = checkContrast(bad);
    expect(report.pass).toBe(false);

    const fgOnBg = report.checks.find((c) => c.pair === 'fg-on-bg');
    expect(fgOnBg?.pass).toBe(false);
    expect(fgOnBg?.ratio).toBeLessThan(AA_NORMAL);
    expect(fgOnBg?.reason).toMatch(/below AA/);
  });

  it('fails loudly on an unparseable colour instead of skipping it', () => {
    const report = checkContrast({ ...resolve(theme()), '--jit-fg': 'oklch(0.9 0.02 250)' });
    const check = report.checks.find((c) => c.pair === 'fg-on-bg');
    expect(report.pass).toBe(false);
    expect(check).toMatchObject({ pass: false, ratio: null });
    expect(check?.reason).toContain('unparseable');
    expect(check?.reason).toContain('oklch');
  });

  it('fails loudly on a missing token instead of assuming a default', () => {
    const { '--jit-accent': _dropped, ...partial } = resolve(theme());
    const report = checkContrast(partial);
    const check = report.checks.find((c) => c.pair === 'on-accent-on-accent');
    expect(report.pass).toBe(false);
    expect(check).toMatchObject({ pass: false, ratio: null });
    expect(check?.reason).toContain('--jit-accent');
  });

  it('narrows the required pairs to the grounds a template actually paints on', () => {
    // A dark page behind a light card.
    // fg is unreadable on bg and perfectly readable on surface — and every
    // node lives inside a Card, so only surface is real.
    const tokens: TokenSet = {
      ...resolve(theme()),
      '--jit-bg': '#1b1b1d',
      '--jit-surface': '#fbfaf7',
      '--jit-fg': '#18181a',
      '--jit-muted': '#6b665e',
    };

    expect(checkContrast(tokens).pass).toBe(false);
    expect(checkContrast(tokens, { surfaces: ['surface'] })).toMatchObject({ pass: true });
    expect(checkContrast(tokens, { surfaces: ['surface'] }).checks).toHaveLength(3);
    expect(checkContrast(tokens, { surfaces: ['bg'] }).pass).toBe(false);
  });
});

describe('resolve / applyPolish', () => {
  it('emits a complete token set for every axis combination', () => {
    const report = checkContrast(resolve(theme()));
    expect(report.checks.every((c) => c.ratio !== null)).toBe(true);
    for (const value of Object.values(resolve(theme({ motif: 'floral' })))) {
      expect(value).not.toBe('');
    }
  });

  it('lets raw polish tokens override enum-derived values, and only those', () => {
    const base = resolve(theme());
    const merged = applyPolish(base, {
      v: 1,
      tokens: { '--jit-accent': '#4ade80', '--jit-radius': '6px' },
      interpretedAs: 'pared-back cutting tool',
    });

    expect(merged['--jit-accent']).toBe('#4ade80');
    expect(merged['--jit-radius']).toBe('6px');
    expect(merged['--jit-bg']).toBe(base['--jit-bg']);
    expect(merged['--jit-gap']).toBe(base['--jit-gap']);
  });

  it('does not mutate the base it was given', () => {
    const base = resolve(theme());
    const before = base['--jit-accent'];
    applyPolish(base, { v: 1, tokens: { '--jit-accent': '#000' }, interpretedAs: 'x' });
    expect(base['--jit-accent']).toBe(before);
  });
});
