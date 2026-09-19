import type { JevAnswer, Node } from './types.js';

/**
 * Minimal demo nodes — proof that the harness seam works, NOT the real
 * orchestration logic. `policy`, `style`, `project` (P2), the real `decide`
 * (P3) and `generate` (P5) are later phases; each demo node below exercises
 * only the one `Ctx` client it will eventually own, so the CLI can run any of
 * them alone against stub clients.
 */

export const decide: Node<string, JevAnswer> = {
  name: 'decide',
  run: (utterance, ctx) => ctx.jev.ask(utterance, ctx.signal),
};

export const policy: Node<string, { templateId: string }> = {
  name: 'policy',
  async run(utterance) {
    return { templateId: utterance.length > 0 ? 'generic_answer' : 'summary_done' };
  },
};

export const style: Node<string, { note: string }> = {
  name: 'style',
  async run(utterance) {
    return { note: `style placeholder for "${utterance}"` };
  },
};

export const project: Node<string, { note: string }> = {
  name: 'project',
  async run(utterance) {
    return { note: `project placeholder for "${utterance}"` };
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

export const research: Node<string, { note: string }> = {
  name: 'research',
  async run(utterance) {
    return { note: `research placeholder for "${utterance}"` };
  },
};

export const NODES: Record<string, Node<string, unknown>> = {
  decide,
  policy,
  style,
  project,
  generate,
  research,
};
