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
export type StyleInput = {
  jev: JevAnswer;
  /**
   * True when the surface that just painted was GENERATED rather than
   * projected from task state.
   *
   * The gate below exists because restyling a surface nobody asked to
   * restyle is jarring — but that reasoning only holds for a surface that
   * PERSISTS. A generated answer is new: it did not exist a moment ago, so
   * there is nothing to jar, and styling it to its own question is the whole
   * point of generating it. Keeping the gate on everything is what made
   * every answer paint in the identical bootstrap theme.
   *
   * Projected task surfaces keep the gate. Repainting the recipe in a new
   * palette mid-bake is the bug p14 found, and it is still a bug.
   */
  generated?: boolean;
};

export const style: Node<StyleInput, StylePatch | null> = {
  name: 'style',
  async run({ jev, generated }) {
    try {
      if (!generated && !jev.wantsStyleChange?.value) return null;

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
