// p19c — does a pre-throw write survive when the consumer is slow?
// p19 Q3 (fast consumer) said yes. It does not: controller.error() discards the
// queue, so Q3 and Q6 are mutually exclusive. See p19d for the fix.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = Annotation.Root({ x: Annotation });
const g = new StateGraph(S)
  .addNode("generate", async (s, c) => {
    for (let i=1;i<=6;i++){ await sleep(50); c.writer({ i }); }   // 6 writes
    await sleep(50); throw new Error("exploded at slot 7");
  })
  .addEdge(START,"generate").addEdge("generate",END).compile();

for (const lag of [0, 50, 150, 300]) {
  const got=[]; let err=null;
  try { for await (const p of await g.stream({x:1},{streamMode:"custom"})) { got.push(p.i); if (lag) await sleep(lag); } }
  catch(e){ err=e.message; }
  console.log(`  consumer lag ${String(lag).padStart(3)}ms -> delivered ${got.length}/6 [${got.join(",")}]  err=${err?"yes":"NO"}  ${got.length<6?"<-- LOST "+(6-got.length):""}`);
}
