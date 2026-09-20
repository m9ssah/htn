import type { Palette } from '@jit/schema';

/**
 * Four palettes. This table exists ONLY to cover the latency of agent 4 — it is
 * not a design library and must not grow. Each entry earns its slot by covering
 * a register the others do not:
 *
 *   slate    the default product surface
 *   mono     low-chroma, for reading — documents, long text, anything dense
 *   rose     warm / soft — "calmer", "softer", "gentler"
 *   contrast max legibility — low vision; the one palette a user asks for by name
 *
 * ---------------------------------------------------------------------------
 * Every palette is dark, and that is a hard rule rather than four coincidences.
 *
 * The shell is a fixed dark plum and cannot restyle itself — it is the device's
 * one constant. A light surface inside it does not read as a themed surface, it
 * reads as a white card dropped on a black device, and the rail, fader and face
 * around it stop belonging to the same object. `applyPolish` enforces the same
 * rule against agent 4's raw tokens, so this is the floor, not a default.
 *
 * ---------------------------------------------------------------------------
 * One accent each, and it is always flat.
 *
 * There are no gradients in this product. Not on tiles, not on buttons, not on
 * progress fills, not on the face. A single accent per palette is what makes
 * that rule enforceable rather than a convention: there is no second colour to
 * interpolate towards, so a gradient cannot be reintroduced by accident.
 */
export type PaletteDefinition = {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  /** The one accent. Always a flat field — there are no gradients anywhere. */
  accent: string;
  onAccent: string;
  accentSoft: string;
  input: string;
};

export const PALETTES: Record<Palette, PaletteDefinition> = {
  /* Plum ground, pink through violet. The device's own register. */
  slate: {
    bg: '#150a11',
    surface: '#22101b',
    border: '#3a1e2e',
    fg: '#f7eef3',
    muted: '#bb9aac',
    accent: '#ff4d7d',
    onAccent: '#1a0a12',
    accentSoft: '#2e1220',
    input: '#1a0c14',
  },

  /* The reading palette: chroma pulled almost out of the ground so long text
     is the only thing with colour in it. Gold through bronze. */
  mono: {
    bg: '#121013',
    surface: '#1c191d',
    border: '#332e34',
    fg: '#f2eff1',
    muted: '#b0a8ad',
    accent: '#ffd257',
    onAccent: '#1a1518',
    accentSoft: '#262027',
    input: '#171418',
  },

  /* Warm and soft: a browner plum, and the ramp stays in the warm half. */
  rose: {
    bg: '#1a0c10',
    surface: '#28141a',
    border: '#42242c',
    fg: '#fbeef0',
    muted: '#c699a3',
    accent: '#ff6b8a',
    onAccent: '#1f0d12',
    accentSoft: '#33161e',
    input: '#1f1015',
  },

  /*
   * Deliberately flat and unlit. The ramp is a style; this palette is a
   * requirement, so all three accents match and every gradient built from them
   * collapses to the one solid block a user who asked for maximum legibility
   * needs. Pure black ground, not plum — no chroma anywhere.
   */
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
