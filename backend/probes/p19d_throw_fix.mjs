// p19d — the fix for p19c: catch INSIDE the node and return normally. All 6
// writes survive at every consumer lag, and the fault rides out as a patch.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = Annotation.Root({ x: Annotation, err: Annotation });

// FIX: catch inside the node, return normally with what we have.
const g = new StateGraph(S)
  .addNode("generate", async (s, c) => {
    try {
      for (let i=1;i<=6;i++){ await sleep(50); c.writer({ i }); }
      await sleep(50); throw new Error("exploded at slot 7");
    } catch (e) { c.writer({ fault: e.message }); return { err: e.message }; }   // normal return
  })
  .addEdge(START,"generate").addEdge("generate",END).compile();

for (const lag of [0, 150, 300, 600]) {
  const got=[]; let fault=null, err=null;
  try { for await (const p of await g.stream({x:1},{streamMode:"custom"})) { if(p.fault) fault=p.fault; else got.push(p.i); if (lag) await sleep(lag); } }
  catch(e){ err=e.message; }
  console.log(`  lag ${String(lag).padStart(3)}ms -> ${got.length}/6 [${got.join(",")}] fault-patch=${fault?"yes":"NO"} threw=${err?"yes":"no"} ${got.length===6&&fault?"<-- all preserved":"<-- STILL LOSSY"}`);
}
