import { describe, expect, it } from 'vitest';
import type { PolishPatch, ThemeEnums } from '@jit/schema';
import {
  COLOR_VARS,
  LIGHT_GROUND_LUMINANCE,
  PALETTES,
  applyPolish,
  isLightGround,
  luminance,
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

const patch = (tokens: PolishPatch['tokens']): PolishPatch => ({
  v: 1,
  tokens,
  interpretedAs: 'test',
});

describe('isLightGround', () => {
  it('rejects the grounds a person would call light', () => {
    for (const light of ['#ffffff', '#fdf8f3', '#f7f7f8', '#e2e2e2', 'rgb(200, 200, 200)']) {
      expect(isLightGround(light), light).toBe(true);
    }
  });

  it('accepts the grounds the device actually paints', () => {
    for (const dark of ['#000000', '#150a11', '#121013', '#1a0c10', '#3a3a3a']) {
      expect(isLightGround(dark), dark).toBe(false);
    }
  });

  it('treats a colour it cannot parse as not-light', () => {
    // Failing closed here would reject every ground written in a notation
    // parseColor does not read yet. Unreadable is the contrast gate's problem.
    for (const odd of ['oklch(0.99 0 0)', 'white', 'var(--x)', '']) {
      expect(isLightGround(odd), odd).toBe(false);
    }
  });
});

describe('the enum table', () => {
  it('is entirely dark, with room to spare either side of the threshold', () => {
    // The rule is only credible if the table itself could never trip it.
    for (const [name, palette] of Object.entries(PALETTES)) {
      const bg = parseColor(palette.bg);
      expect(bg, name).not.toBeNull();
      expect(luminance(bg!), name).toBeLessThan(LIGHT_GROUND_LUMINANCE / 4);
    }
  });
});

describe('applyPolish, against a light patch', () => {
  const base = resolve(theme());

  it('reverts every colour to the enum base', () => {
    const out = applyPolish(
      base,
      patch({
        '--jit-bg': '#ffffff',
        '--jit-surface': '#fafafa',
        '--jit-fg': '#111111',
        '--jit-accent': '#a8541f',
      }),
    );
    for (const name of COLOR_VARS) expect(out[name], name).toBe(base[name]);
  });

  it('still lets through everything that is not a colour', () => {
    // A rejected patch is not a rejected generation. The surface still
    // restyles; it just does not take the device's ground with it.
    const out = applyPolish(
      base,
      patch({ '--jit-bg': '#ffffff', '--jit-radius': '26px', '--jit-gap': '30px' }),
    );
    expect(out['--jit-radius']).toBe('26px');
    expect(out['--jit-gap']).toBe('30px');
    expect(out['--jit-bg']).toBe(base['--jit-bg']);
  });

  it('catches a patch that is light only once merged with the base', () => {
    // The check is on the MERGED result, not on the patch in isolation: a patch
    // naming no bg at all can still be handed a light one by a previous patch.
    const lightBase = { ...base, '--jit-bg': '#ffffff' };
    const out = applyPolish(lightBase, patch({ '--jit-accent': '#a8541f' }));
    expect(out['--jit-accent']).toBe(lightBase['--jit-accent']);
  });
});

describe('applyPolish, against a dark patch', () => {
  it('passes the whole thing through untouched', () => {
    const base = resolve(theme());
    const tokens = {
      '--jit-bg': '#1d0a14',
      '--jit-accent': '#d64a7e',
      '--jit-radius': '26px',
    } as const;
    const out = applyPolish(base, patch({ ...tokens }));
    for (const [name, value] of Object.entries(tokens)) {
      expect(out[name as keyof typeof out]).toBe(value);
    }
  });
});
