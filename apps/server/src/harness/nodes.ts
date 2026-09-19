import type { JevAnswer, Node } from './types.js';

/**
 * The registry the CLI lists and runs from. `decide` and `generate` are real
 * demo nodes that exercise a `Ctx` client each, proving the harness seam
 * works. `policy`, `style`, `project` and `research` are NOT implemented here
 * — that's P2's (and an unassigned phase's, for `research`) job — and they
 * throw rather than silently succeed, so a stub can never be mistaken for a
 * working node or "fill in" work that hasn't happened yet.
 */

export const decide: Node<string, JevAnswer> = {
  name: 'decide',
  run: (utterance, ctx) => ctx.jev.ask(utterance, ctx.signal),
};

export const policy: Node<string, never> = {
  name: 'policy',
  async run(): Promise<never> {
    throw new Error('policy: not implemented until P2');
  },
};

export const style: Node<string, never> = {
  name: 'style',
  async run(): Promise<never> {
    throw new Error('style: not implemented until P2');
  },
};

export const project: Node<string, never> = {
  name: 'project',
  async run(): Promise<never> {
    throw new Error('project: not implemented until P2');
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

export const research: Node<string, never> = {
  name: 'research',
  async run(): Promise<never> {
    throw new Error('research: not implemented — no phase in the plan owns this node yet');
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
