import type { StylePatch } from '@jit/schema';
import type { JevAnswer, JevState, Node } from './types.js';
import { policy } from './nodes/policy.js';
import { style } from './nodes/style.js';
import { project } from './nodes/project.js';

/**
 * The registry the CLI lists and runs from. `decide` (P3) and `generate`
 * (P5) take a `Ctx` client and a CLI-buildable input (see `cli.ts`'s
 * `INPUT_BUILDERS`), so `npm run node -- <name> ...` exercises them
 * meaningfully. `policy`/`style`/`project` (P2) are pure, total functions of
 * a structured input `Ctx` cannot supply from bare argv — they are listed so
 * the registry names every implemented node, but the CLI's string-argv
 * fallback does not build a meaningful input for them; `test/harness/nodes/`
 * exercises those instead. `research` has no owning phase, so it isn't
 * listed at all — see docs/orchestration-plan.md's "Node inventory".
 */

/**
 * `decide`'s output. It hands back the naive `SkeletonPatch`/`StylePatch`
 * built directly from what Jev said, PLUS the full `JevAnswer` (every
 * question's distribution) — deciding whether to actually *apply*
 * `templateId` (vs. keep the current surface on `refine`/`correct`/`select`)
 * is `policy`'s job (P2), not this node's. See docs/orchestration-plan.md
 * "The shape".
 */
export type DecideResult = {
  style: StylePatch;
  jev: JevAnswer;
};

export const decide: Node<JevState, DecideResult> = {
  name: 'decide',
  async run(state, ctx) {
    const jev = await ctx.jev.ask(state, ctx.signal);
    const style: StylePatch = {
      v: 1,
      theme: {
        palette: jev.theme.palette.value,
        fontPairing: jev.theme.fontPairing.value,
        density: jev.theme.density.value,
        radius: jev.theme.radius.value,
        motif: jev.theme.motif.value,
      },
    };
    return { style, jev };
  },
};

/**
 * `decide` and `generate` take different input types (`JevState` vs.
 * `GenerateInput`), so the registry can't be typed as one `Node<In, unknown>`
 * without losing one of them. It exists only for the CLI's name -> node
 * lookup, whose caller (`cli.ts`) already knows which input shape to build
 * per name — hence `any` here rather than a heavier existential wrapper for a
 * two-entry table.
 */
export const NODES: Record<string, Node<any, unknown>> = {
  decide,
  policy,
  style,
  project,
};
