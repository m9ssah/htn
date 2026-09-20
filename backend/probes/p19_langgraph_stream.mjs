// p19 — LangGraph streaming spike (M2). Answers the architecture questions in
// docs/orchestration-plan.md "What the LangGraph spike settled".
//   setup:  npm init -y && npm i @langchain/langgraph @langchain/core
//   run:    node p19_langgraph_stream.mjs
// Verified against @langchain/langgraph 1.4.16 on 2026-09-19.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let T0 = 0;
const t = () => Math.round(performance.now() - T0);

const S = Annotation.Root({
  utterance: Annotation,
  template:  Annotation,
  done:      Annotation({ reducer: (a=[], b=[]) => a.concat(b), default: () => [] }),
});

// ---- nodes -----------------------------------------------------------------
// decide: the Jev call. Writes skeleton the instant it has it.
const decide = async (s, cfg) => {
  await sleep(200);                                  // one batched Jev call
  cfg.writer({ kind: "skeleton", templateId: "item_detail", wroteAt: t() });
  cfg.writer({ kind: "style", palette: "warm", wroteAt: t() });
  return { template: "item_detail" };
};

// generate: the LLM. 13 slots dribbling out over ~5s.
const makeGenerate = (throwAt = -1, slots = 13, gap = 380) => async (s, cfg) => {
  for (let i = 1; i <= slots; i++) {
    await sleep(gap);
    if (i === throwAt) throw new Error(`generate exploded at slot ${i}`);
    cfg.writer({ kind: "content", slot: `slot_${i}`, wroteAt: t() });
  }
  return { done: ["generate"] };
};

// style: an independent Jev call, to test fan-out concurrency.
const style = async (s, cfg) => {
  await sleep(250);
  cfg.writer({ kind: "style2", wroteAt: t() });
  return { done: ["style"] };
};

// a writer called from inside a nested async generator (Q4)
const nested = async (s, cfg) => {
  async function* slots() { for (let i = 1; i <= 3; i++) { await sleep(100); yield i; } }
  for await (const i of slots()) cfg.writer({ kind: "nested", i, wroteAt: t() });
  return {};
};

const build = (gen) => new StateGraph(S)
  .addNode("decide", decide)
  .addNode("generate", gen)
  .addEdge(START, "decide").addEdge("decide", "generate").addEdge("generate", END)
  .compile();

// ---- runner ----------------------------------------------------------------
async function run(label, graph, { consumerLagMs = 0, modes = ["custom"] } = {}) {
  T0 = performance.now();
  const log = [];
  let err = null;
  try {
    for await (const chunk of await graph.stream({ utterance: "hi" }, { streamMode: modes })) {
      const [mode, payload] = Array.isArray(chunk) ? chunk : ["custom", chunk];
      log.push({ mode, got: t(), ...(payload ?? {}) });
      if (consumerLagMs) await sleep(consumerLagMs);
    }
  } catch (e) { err = e.message; }
  console.log(`\n=== ${label} ===`);
  for (const r of log) {
    const lag = r.wroteAt != null ? `+${r.got - r.wroteAt}ms` : "";
    console.log(`  ${String(r.got).padStart(5)}ms  ${r.mode.padEnd(7)} ${r.kind ?? JSON.stringify(r).slice(0,60)} ${r.slot ?? r.i ?? ""} ${lag}`);
  }
  if (err) console.log(`  THREW at ${t()}ms: ${err}`);
  console.log(`  -> ${log.length} chunks, error=${err ? "yes" : "no"}`);
  return { log, err };
}

// ---- Q1/Q2: does a patch escape before the graph completes? -----------------
await run("A. happy path (Q1 escape-early, Q2 per-patch overhead)", build(makeGenerate()));

// ---- Q3: node throws mid-stream. do earlier writes survive? ----------------
await run("B. generate throws at slot 7 (Q3 partial survival)", build(makeGenerate(7)));

// ---- Q4: writer from inside a nested async generator -----------------------
await run("C. writer inside async generator (Q4)",
  new StateGraph(S).addNode("nested", nested).addEdge(START, "nested").addEdge("nested", END).compile());

// ---- Q5: fan-out. do two nodes' writes interleave, or serialize? -----------
await run("D. fan-out decide||style, both then generate (Q5 concurrency)",
  new StateGraph(S)
    .addNode("decide", decide).addNode("style", style).addNode("generate", makeGenerate(-1, 3, 200))
    .addEdge(START, "decide").addEdge(START, "style")
    .addEdge("decide", "generate").addEdge("style", "generate").addEdge("generate", END)
    .compile());

// ---- Q6: backpressure. slow consumer -> does the graph stall? --------------
await run("E. consumer lags 300ms/chunk (Q6 backpressure)", build(makeGenerate(-1, 5, 100)), { consumerLagMs: 300 });

// ---- Q7: can we get custom + updates together? -----------------------------
await run("F. streamMode:['custom','updates'] (Q7 telemetry channel)", build(makeGenerate(-1, 2, 100)),
  { modes: ["custom", "updates"] });

// ---- Q8: does a slow consumer stall the NODE, or only delivery? ------------
{
  const gg = new StateGraph(S)
    .addNode("decide", async (s, c) => { await sleep(200); c.writer({ kind:"skeleton", wroteAt:t() }); return {}; })
    .addNode("generate", makeGenerate(-1, 5, 100))
    .addEdge(START,"decide").addEdge("decide","generate").addEdge("generate",END).compile();
  await run("G. baseline, no consumer lag", gg, { consumerLagMs: 0 });
  await run("H. consumer lags 300ms/chunk -- compare wroteAt, not got", gg, { consumerLagMs: 300 });
}

// ---- Q9/Q10: barge-in. does cancelling the stream stop the node? ----------
// Run separately: node p19b_langgraph_cancel.mjs
