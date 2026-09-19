import type { Density, Motif, Radius } from '@jit/schema';

export type DensityDefinition = {
  gap: string;
  pad: string;
  /** Multiplier on component-internal padding. */
  factor: string;
  /** Multiplier on the type scale. */
  scale: string;
};

export const DENSITIES: Record<Density, DensityDefinition> = {
  compact: { gap: '8px', pad: '14px', factor: '0.85', scale: '0.94' },
  normal: { gap: '14px', pad: '20px', factor: '1', scale: '1' },
  spacious: { gap: '22px', pad: '28px', factor: '1.2', scale: '1.12' },
};

export type RadiusDefinition = { radius: string; radiusSm: string };

export const RADII: Record<Radius, RadiusDefinition> = {
  sharp: { radius: '0px', radiusSm: '0px' },
  soft: { radius: '12px', radiusSm: '8px' },
  round: { radius: '22px', radiusSm: '14px' },
};

/**
 * Motifs are a decorative background-image layer drawn with `currentColor`, so
 * they inherit the palette instead of carrying colour of their own.
 */
export const MOTIFS: Record<Motif, string> = {
  none: 'none',
  floral:
    'radial-gradient(circle at 20% 30%, currentColor 1.6px, transparent 1.7px), ' +
    'radial-gradient(circle at 70% 75%, currentColor 1.1px, transparent 1.2px)',
  geometric:
    'linear-gradient(45deg, currentColor 1px, transparent 1px), ' +
    'linear-gradient(-45deg, currentColor 1px, transparent 1px)',
};
