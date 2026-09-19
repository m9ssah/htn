import type { PolishPatch, ThemeEnums, TokenSet } from '@jit/schema';
import { PALETTES } from './palettes.js';
import { FONTS } from './fonts.js';
import { DENSITIES, MOTIFS, RADII } from './scale.js';

/**
 * The width the surface falls back to before a skeleton patch supplies its own.
 * Every template overrides this; it exists so `resolve()` can emit a complete
 * TokenSet rather than a near-complete one.
 */
export const DEFAULT_MAX_WIDTH = '420px';

/**
 * Enum selections -> concrete CSS custom properties.
 *
 * Emits the COMPLETE set. A partial return here would mean the renderer reads a
 * var nothing ever wrote, which paints as an empty string and fails silently —
 * exactly the class of bug constraint 6 exists to prevent.
 */
export function resolve(theme: ThemeEnums): TokenSet {
  const palette = PALETTES[theme.palette];
  const font = FONTS[theme.fontPairing];
  const density = DENSITIES[theme.density];
  const radius = RADII[theme.radius];

  return {
    '--jit-bg': palette.bg,
    '--jit-surface': palette.surface,
    '--jit-border': palette.border,
    '--jit-fg': palette.fg,
    '--jit-muted': palette.muted,
    '--jit-accent': palette.accent,
    '--jit-on-accent': palette.onAccent,
    '--jit-accent-soft': palette.accentSoft,
    '--jit-input': palette.input,

    '--jit-font-display': font.display,
    '--jit-font-body': font.body,
    '--jit-weight-display': font.weightDisplay,
    '--jit-scale': density.scale,

    '--jit-gap': density.gap,
    '--jit-pad': density.pad,
    '--jit-density-f': density.factor,

    '--jit-radius': radius.radius,
    '--jit-radius-sm': radius.radiusSm,

    '--jit-motif': MOTIFS[theme.motif],
    '--jit-maxw': DEFAULT_MAX_WIDTH,
  };
}

/**
 * Agent 4's raw tokens override every enum-derived value. The enum base is only
 * a latency cover; once the generative pass lands, it wins on the axes it spoke
 * to and leaves the rest alone.
 */
export function applyPolish(base: TokenSet, polish: PolishPatch): TokenSet {
  return { ...base, ...polish.tokens };
}
