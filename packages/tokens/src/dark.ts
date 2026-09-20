import type { CssVar, TokenSet } from '@jit/schema';
import { luminance, parseColor } from './contrast.js';

/**
 * The ground is dark. Always.
 *
 * The shell — face, rail, fader, home — is a fixed dark plum and has no theme
 * of its own to change. So a light generated surface does not read as a themed
 * surface; it reads as a white card dropped onto a black device, and everything
 * framing it stops belonging to the same object. The enum palettes are all dark
 * by construction, but agent 4 emits RAW tokens, and nothing in the patch
 * contract stops it emitting `--jit-bg: #ffffff`. This is what stops it.
 */

/**
 * Relative luminance above which a ground reads as light.
 *
 * 0.18 sits well above every palette in the enum table (the lightest is under
 * 0.02) and well below any ground a person would call light — mid grey is about
 * 0.21. The gap either side is deliberate: a threshold this far from both
 * populations does not need to be re-tuned every time a palette moves.
 */
export const LIGHT_GROUND_LUMINANCE = 0.18;

/**
 * The colour half of the contract.
 *
 * Only these are reverted when a patch is rejected. Everything else agent 4
 * asked for — radius, density, type, extent, motif — still lands, because the
 * rule being enforced is about the ground, not about taste. A model that wanted
 * a light theme and sharp corners still gets the sharp corners.
 */
export const COLOR_VARS: readonly CssVar[] = [
  '--jit-bg',
  '--jit-surface',
  '--jit-border',
  '--jit-fg',
  '--jit-muted',
  '--jit-accent',
  '--jit-on-accent',
  '--jit-accent-soft',
  '--jit-input',
];

/**
 * True if this colour is too light to be the device's ground.
 *
 * An unparseable colour is NOT light. `parseColor` returns null for anything it
 * cannot certify, and treating that as a violation would reject every ground
 * written in a notation it does not read yet — failing closed on the wrong
 * axis. The contrast gate is what catches a ground that is merely unreadable.
 */
export function isLightGround(color: string): boolean {
  const rgb = parseColor(color);
  if (rgb === null) return false;
  return luminance(rgb) > LIGHT_GROUND_LUMINANCE;
}
