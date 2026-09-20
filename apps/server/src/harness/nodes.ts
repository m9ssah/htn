import type { SkeletonPatch, StylePatch } from '@jit/schema';
import { TEMPLATES } from '@jit/renderer';
import type { JevAnswer, JevState, Node } from './types.js';

/**
 * The registry the CLI lists and runs from — deliberately just the two nodes
 * that actually exercise a `Ctx` client, so `npm run node --` never lists a
 * name that is guaranteed to fail. The full intended node set (`decide`,
 * `policy`, `style`, `project`, `generate`, `research`) is recorded in
 * `docs/orchestration-plan.md`'s "Node inventory" — that table doesn't claim
 * runnability, so it isn't lying the way this registry would if it listed
 * unimplemented names. `policy`/`style`/`project` are P2's job; `research`
 * has no phase yet.
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
  skeleton: SkeletonPatch;
  style: StylePatch;
  jev: JevAnswer;
};

export const decide: Node<JevState, DecideResult> = {
  name: 'decide',
  async run(state, ctx) {
    const jev = await ctx.jev.ask(state, ctx.signal);
    const skeleton: SkeletonPatch = {
      v: 1,
      templateId: jev.templateId.value,
      maxWidth: TEMPLATES[jev.templateId.value].maxWidth,
    };
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
    return { skeleton, style, jev };
  },
};

export const generate: Node<string, string[]> = {
  name: 'generate',
  async run(prompt, ctx) {
    const chunks: string[] = [];
    for await (const chunk of ctx.content.stream(prompt, ctx.signal)) {
      chunks.push(chunk);
      // Exercises the sink from inside a node, as the real `generate` (P5)
      // will: one PolishPatch per chunk is a legal, minimal stand-in for
      // "some patch landed" without inventing a ContentPatch slot mapping.
      ctx.sink.emit({ v: 1, tokens: {}, interpretedAs: chunk });
    }
    return chunks;
  },
};

/**
 * `decide` and `generate` take different input types (`JevState` vs.
 * `string`), so the registry can't be typed as one `Node<In, unknown>` without
 * losing one of them. It exists only for the CLI's name -> node lookup, whose
 * caller (`cli.ts`) already knows which input shape to build per name — hence
 * `any` here rather than a heavier existential wrapper for a two-entry table.
 */
export const NODES: Record<string, Node<any, unknown>> = {
  decide,
  generate,
};
