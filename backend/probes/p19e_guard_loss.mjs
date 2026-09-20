// Throwaway: reproduces p19c/p19d against the installed langgraph, to put a
// number on "how many patches the guard actually saves" at each consumer lag.
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = Annotation.Root({ x: Annotation });

const build = (guarded) =>
  new StateGraph(S)
    .addNode('n', async (s, c) => {
      const body = async () => {
        for (let i = 1; i <= 6; i++) c.writer({ i });
        throw new Error('boom at 7');
      };
      if (!guarded) return await body().then(() => ({ x: 1 }));
      try {
        await body();
      } catch {
        /* caught inside, return normally — p19d */
      }
      return { x: 1 };
    })
    .addEdge(START, 'n')
    .addEdge('n', END)
    .compile();

for (const guarded of [false, true]) {
  for (const lag of [0, 150, 300]) {
    const got = [];
    let threw = false;
    try {
      for await (const c of await build(guarded).stream({ x: 0 }, { streamMode: ['custom'] })) {
        got.push(c[1].i);
        if (lag) await sleep(lag);
      }
    } catch {
      threw = true;
    }
    console.log(`guarded=${String(guarded).padEnd(5)} lag=${String(lag).padStart(3)}ms  delivered ${got.length}/6  threw=${threw}`);
  }
}
