import type { Palette } from '@jit/schema';

/**
 * Four palettes. This table exists ONLY to cover the latency of agent 4 — it is
 * not a design library and must not grow. Each entry earns its slot by covering
 * a register the others do not:
 *
 *   slate    dark neutral   — the default product surface
 *   mono     light neutral  — paper, documents, anything to be read
 *   rose     warm / soft    — "calmer", "softer", "gentler"
 *   contrast max legibility — low vision; the one palette a user asks for by name
 */
export type PaletteDefinition = {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  input: string;
};

export const PALETTES: Record<Palette, PaletteDefinition> = {
  slate: {
    bg: '#0e1014',
    surface: '#171a21',
    border: '#2a2f3a',
    fg: '#e8eaf0',
    muted: '#9aa2b2',
    accent: '#5b7cfa',
    onAccent: '#08101f',
    // Was #1c2333 — accent-on-accent-soft (Badge's text-on-background) measured
    // 4.27:1 there, below the 4.5:1 AA floor. Darkened; accent/fg against it now
    // measure 4.63:1 / 14.17:1. See contrast.test.ts.
    accentSoft: '#161c29',
    input: '#12151b',
  },
  mono: {
    bg: '#fafafa',
    surface: '#ffffff',
    border: '#e2e2e2',
    fg: '#111111',
    muted: '#5d5d5d',
    accent: '#111111',
    onAccent: '#ffffff',
    accentSoft: '#efefef',
    input: '#fcfcfc',
  },
  rose: {
    bg: '#fff5f8',
    surface: '#ffffff',
    border: '#f6d6e2',
    fg: '#3d1f2b',
    muted: '#8a5566',
    accent: '#b83a6b',
    onAccent: '#ffffff',
    accentSoft: '#fde8f0',
    input: '#fffafc',
  },
  contrast: {
    bg: '#000000',
    surface: '#000000',
    border: '#ffffff',
    fg: '#ffffff',
    muted: '#e6e6e6',
    accent: '#ffe600',
    onAccent: '#000000',
    accentSoft: '#1a1a00',
    input: '#000000',
  },
};
