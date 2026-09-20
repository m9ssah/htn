import type { JevAnswer, Node } from './types.js';

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

export const decide: Node<string, JevAnswer> = {
  name: 'decide',
  run: (utterance, ctx) => ctx.jev.ask(utterance, ctx.signal),
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

export const NODES: Record<string, Node<string, unknown>> = {
  decide,
  generate,
};
