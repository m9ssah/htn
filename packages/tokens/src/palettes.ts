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
 *
 * Every entry carries a second accent. Metro's flat colour field is the bones of
 * this design, but a modern one is lit rather than printed, and one interpolated
 * gradient per accent surface is the cheapest way to say so: it is painted once
 * and never animated, so it costs the device a single composite and nothing per
 * frame. `accent2` is always a neighbour in hue, never a second brand colour —
 * if the two read as two colours the gradient has failed.
 */
export type PaletteDefinition = {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  /** Gradient partner for `accent`. Must keep `onAccent` legible over it too. */
  accent2: string;
  onAccent: string;
  accentSoft: string;
  input: string;
};

export const PALETTES: Record<Palette, PaletteDefinition> = {
  slate: {
    bg: '#07090e',
    surface: '#11141c',
    border: '#242936',
    fg: '#eef0f6',
    muted: '#a2aabb',
    accent: '#6d5cf6',
    accent2: '#3ba8ff',
    onAccent: '#ffffff',
    accentSoft: '#1a1b30',
    input: '#0c0f16',
  },
  mono: {
    bg: '#f7f7f8',
    surface: '#ffffff',
    border: '#e4e4e7',
    fg: '#0c0c0f',
    muted: '#57575e',
    accent: '#18181b',
    accent2: '#3f3f4a',
    onAccent: '#ffffff',
    accentSoft: '#ededf0',
    input: '#fcfcfd',
  },
  rose: {
    bg: '#fff5f8',
    surface: '#ffffff',
    border: '#f5d8e3',
    fg: '#361a25',
    muted: '#82505f',
    accent: '#b8336a',
    accent2: '#d9534f',
    onAccent: '#ffffff',
    accentSoft: '#fde9f0',
    input: '#fffafc',
  },
  /*
   * Deliberately left flat and unlit. The gradient is a style; this palette is a
   * requirement, and `accent2` matches `accent` so the accent field stays one
   * solid unambiguous block for a user who asked for maximum legibility.
   */
  contrast: {
    bg: '#000000',
    surface: '#000000',
    border: '#ffffff',
    fg: '#ffffff',
    muted: '#e6e6e6',
    accent: '#ffe600',
    accent2: '#ffe600',
    onAccent: '#000000',
    accentSoft: '#1a1a00',
    input: '#000000',
  },
};
