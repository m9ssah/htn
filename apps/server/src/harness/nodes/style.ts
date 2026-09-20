import type { StylePatch, ThemeEnums } from '@jit/schema';
import type { JevAnswer, Node } from '../types.js';

/**
 * Maps Jev's five axis answers to a `StylePatch` — enums only, never a hex
 * code (that's agent 4's job, a different patch).
 *
 * The gate: p14 measured Jev picks a theme on EVERY utterance, restyling a
 * surface nobody asked to restyle ("show me the whole recipe" came back with
 * contrast/editorial/sharp). `wantsStyleChange` (a `noul`, added to the
 * batched call in jev-questions.ts) is the only gate — no route-based
 * special-casing: a `refine` that is actually a style ask
 * ("make it high contrast") gets a true noul and emits; a `refine` that
 * isn't gets a false noul and emits nothing, independently of whatever
 * `policy` does with the template.
 *
 * Missing `wantsStyleChange` (the four recorded fixtures predate it) is
 * treated as "no" — the safe default, since emitting an unrequested restyle
 * is the exact failure this gate exists to prevent.
 */
export const style: Node<JevAnswer, StylePatch | null> = {
  name: 'style',
  async run(jev) {
    try {
      if (!jev.wantsStyleChange?.value) return null;

      const theme: ThemeEnums = {
        palette: jev.theme.palette.value,
        fontPairing: jev.theme.fontPairing.value,
        density: jev.theme.density.value,
        radius: jev.theme.radius.value,
        motif: jev.theme.motif.value,
      };
      return { v: 1, theme };
    } catch {
      // Total: a styling failure must never block paint. No patch, not a throw.
      return null;
    }
  },
};
