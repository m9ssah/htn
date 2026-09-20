// p19b — LangGraph cancellation / barge-in spike (M2, part 2).
// Question: the user speaks again while `generate` is mid-stream. Does anything
// actually STOP the node, or do we keep paying for a turn nobody is listening to?
//   setup:  npm i @langchain/langgraph @langchain/core
//   run:    node p19b_langgraph_cancel.mjs
// Result: break / AbortController.abort() / iterator.return() all leave the node
// running to completion. Only threading config.signal into the node's OWN await
// stops it. Cancellation is COOPERATIVE.
// Verified against @langchain/langgraph 1.4.16 on 2026-09-19.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

const sleep = (ms, sig) => new Promise((res, rej) => {
  const id = setTimeout(res, ms);
  sig?.addEventListener("abort", () => { clearTimeout(id); rej(new Error("aborted")); }, { once: true });
});
let T0 = 0; const t = () => Math.round(performance.now() - T0);
const S = Annotation.Root({ x: Annotation });

// `side` stands in for the thing that actually costs money: tokens emitted by
// the LLM. If it keeps growing after the consumer has left, we are burning it.
let side = [];

const build = (cooperative) => new StateGraph(S)
  .addNode("decide", async (s, c) => { await sleep(150); c.writer({ k: "skeleton", wroteAt: t() }); return {}; })
  .addNode("generate", async (s, c) => {
    for (let i = 1; i <= 10; i++) {
      if (cooperative) {
        try { await sleep(200, c.signal); } catch { console.log(`    [node] aborted at slot ${i}, ${t()}ms`); return {}; }
        if (c.signal?.aborted) { console.log(`    [node] aborted at slot ${i}, ${t()}ms`); return {}; }
      } else {
        await sleep(200);
      }
      side.push(`slot${i}@${t()}ms`);
      c.writer({ k: "content", i, wroteAt: t() });
    }
    return {};
  })
  .addEdge(START, "decide").addEdge("decide", "generate").addEdge("generate", END).compile();

async function run(label, how, cooperative = false) {
  T0 = performance.now(); side = [];
  const g = build(cooperative), ac = new AbortController(), got = [];
  let err = null;
  try {
    const it = await g.stream({ x: 1 }, { streamMode: "custom", signal: ac.signal });
    for await (const p of it) {
      got.push(`${p.k}${p.i ?? ""}@${p.wroteAt}ms`);
      if (got.length === 4) {                    // "user speaks again" at ~750ms
        if (how === "break")  break;
        if (how === "abort")  { ac.abort(); }
        if (how === "return") { await it.return?.(); break; }
      }
    }
  } catch (e) { err = `${e.name}: ${e.message.slice(0, 50)}`; }
  const atExit = t(), seen = side.length;
  await sleep(2500);                             // did it keep burning after we left?
  console.log(`\n=== ${label} ===`);
  console.log(`  consumer got ${got.length}: ${got.join(" ")}`);
  console.log(`  error: ${err ?? "none"}`);
  console.log(`  slots emitted at loop exit (${atExit}ms): ${seen}`);
  console.log(`  slots emitted 2.5s later:       ${side.length}  ${side.length > seen ? "<-- NODE KEPT RUNNING, tokens leaked" : "<-- node stopped on time"}`);
  if (side.length > seen) console.log(`  leaked: ${side.slice(seen).join(" ")}`);
}

await run("I. consumer `break`s out of the for-await", "break");
await run("J. AbortController.abort() on the config signal", "abort");
await run("K. explicit iterator .return()", "return");
await run("L. node threads config.signal into its own await", "abort", true);
