import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { stubContentSource } from './harness/clients/content.js';
import { BasetenContentModel, stubContentModel } from './harness/clients/content-model.js';
import { stubJevClient } from './harness/clients/jev.js';
import { runtimeOf } from './harness/graph-runtime.js';
import type { PatchStream } from './harness/turn.js';
import { createSurfaceServer } from './ws-server.js';

/**
 * The server entry point.
 *
 *   npm run serve            # 127.0.0.1:8787
 *   JIT_PORT=9000 npm run serve
 *
 * The transport is real. **The graph is not wired yet** — the node set is
 * still moving (`contract-fix`, `projected-composer`), so this boots with a
 * placeholder that emits nothing and says so, rather than with a hardcoded
 * flow. A device that connects gets a real `turn-start`, zero updates, and a
 * real `turn-end` — which is the honest state, and is falsifiable in a way
 * that a canned demo surface would not be (CLAUDE.md constraint 5: never
 * hardcode a fallback that hides a failure; constraint 6: the flow is never
 * hardcoded).
 *
 * Replacing `notWiredGraph` with the real compiled graph is the only change
 * this file needs.
 */

const PlaceholderState = Annotation.Root({ utterance: Annotation<string> });

const notWiredGraph = new StateGraph(PlaceholderState)
  .addNode('not-wired', async (_state, config: LangGraphRunnableConfig) => {
    const turn = runtimeOf(config);
    turn.note('graph-not-wired', {
      detail: 'the concrete decide/policy/style/compose graph has not been wired yet',
    });
    return {};
  })
  .addEdge(START, 'not-wired')
  .addEdge('not-wired', END)
  .compile() as unknown as PatchStream;

const port = Number(process.env.JIT_PORT ?? 8787);
const host = process.env.JIT_HOST ?? '127.0.0.1';

/**
 * The real content model only when it is actually configured, and the boot log
 * says which one is live either way. A silent stub fallback would make an
 * unconfigured endpoint look like a working one until a judge read the copy
 * (constraint 5); the stub's own placeholder strings are deliberately
 * unmistakable for the same reason.
 */
const contentModelUrl = process.env.JIT_CONTENT_MODEL_URL;
const contentModel = contentModelUrl ? new BasetenContentModel() : stubContentModel;

const server = await createSurfaceServer({
  port,
  host,
  deps: { graph: notWiredGraph, jev: stubJevClient, content: stubContentSource, contentModel },
});

process.stderr.write(
  `${JSON.stringify({
    event: 'listening',
    url: server.url,
    graph: 'NOT WIRED — emits nothing',
    contentModel: contentModelUrl ? `live: ${contentModelUrl}` : 'STUB — set JIT_CONTENT_MODEL_URL for the trained model',
  })}\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
