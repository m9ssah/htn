// End-to-end: 10 HELD-OUT utterances (none in the 4 recorded fixtures)
// through the real turn transport against the real Jev endpoint.
// decide (live Jev) -> policy -> style, patches streamed out of the graph.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
const D = '/Users/steric/work/03-Projects/htn/htn/apps/server/dist';
const { runGuarded, runtimeOf } = await import(`${D}/harness/graph-runtime.js`);
const { startTurn } = await import(`${D}/harness/turn.js`);
const { decide } = await import(`${D}/harness/nodes.js`);
const { policy } = await import(`${D}/harness/nodes/policy.js`);
const { style } = await import(`${D}/harness/nodes/style.js`);
const { JevHttpClient } = await import(`${D}/harness/clients/jev.js`);
const { stubContentSource } = await import(`${D}/harness/clients/content.js`);

const CASES = [
  ['turn the lights down in here',           null,           'nothing started'],
  ['how long do I boil an egg',              null,           'nothing started'],
  ['actually make it three times the batch', 'item_detail',  'cookie recipe open, 30 cookies'],
  ['I forgot the baking soda',               'focus_step',   'step 4 of 6, wet+dry combined'],
  ['make this easier to read from far away', 'focus_step',   'step 2 of 6'],
  ['who lives closest to me',                null,           'nothing started'],
  ['tell Priya I will be 20 minutes late',   null,           'nothing started'],
  ['go back to the previous one',            'choice_cards', '3 recipe options on screen'],
  ['what did that cost in total',            'summary_done', 'batch finished, 30 cookies'],
  ['this one',                               'choice_cards', '3 recipe options on screen'],
];

const keep = { reducer: (_a, b) => b, default: () => null };
const State = Annotation.Root({
  utterance: Annotation(keep), currentTemplate: Annotation(keep), taskState: Annotation(keep),
  jev: Annotation(keep), policyOut: Annotation(keep),
});

const graph = new StateGraph(State)
  .addNode('decide', async (state, config) => {
    const turn = runtimeOf(config);
    const r = await runGuarded(decide, state, turn, 'node-crashed');
    if (!r.ok) { turn.note('decide-failed', { aborted: r.aborted }); return {}; }
    lastJev = r.out.jev;
    return { jev: r.out.jev };
  })
  .addNode('policy', async (state, config) => {
    const turn = runtimeOf(config);
    if (!state.jev) return {};
    const r = await runGuarded(policy, {
      route: state.jev.route.value,
      jevTemplateId: state.jev.templateId.value,
      currentTemplate: state.currentTemplate,
      hasDeviation: false,
    }, turn, 'node-crashed');
    return r.ok ? { policyOut: r.out } : {};
  })
  .addNode('style', async (state, config) => {
    const turn = runtimeOf(config);
    if (!state.jev) return {};
    const r = await runGuarded(style, state.jev, turn, 'node-crashed');
    if (r.ok && r.out) turn.ctx.sink.emit(r.out);
    return {};
  })
  .addEdge(START, 'decide').addEdge('decide', 'policy')
  .addEdge('policy', 'style').addEdge('style', END)
  .compile();

let lastJev = null;
const jev = new JevHttpClient({ maxUsd: 1.0 });
const rows = [];
for (const [utterance, currentTemplate, taskState] of CASES) {
  const t0 = performance.now();
  const turn = startTurn({ utterance, currentTemplate, taskState }, {
    graph, jev, content: stubContentSource, logPath: null,
  });
  const patches = []; let err = '';
  try { for await (const p of turn.patches) patches.push(p); }
  catch (e) { err = String(e?.message ?? e).slice(0, 44); }
  const total = Math.round(performance.now() - t0);
  const entries = turn.log.entries ?? [];
  const failed = entries.some((e) => e.name === 'decide-failed' || e.kind === 'fault');
  const st = patches.find((p) => p?.theme);
  const j = lastJev;
  rows.push({ utterance, patches: patches.length, total,
    route: j ? `${j.route.value}(${j.route.confidence.toFixed(2)})` : '—',
    gate: j?.wantsStyleChange ? String(j.wantsStyleChange.value) : '—',
    palette: st ? st.theme.palette : '—', failed: failed ? 'FAULT' : '', err });
}

console.log('\n' + 'utterance'.padEnd(40) + 'route'.padEnd(17) + 'gate  patch  palette   ms');
console.log('-'.repeat(92));
for (const r of rows) console.log(
  r.utterance.slice(0, 38).padEnd(40) + String(r.route).padEnd(17) +
  String(r.gate).padEnd(6) + String(r.patches).padEnd(7) +
  String(r.palette).padEnd(10) + r.total + r.failed + r.err);
const lat = rows.map((r) => r.total).sort((a, b) => a - b);
console.log(`\nturn latency  min ${lat[0]}ms  p50 ${lat[5]}ms  max ${lat.at(-1)}ms`);
console.log(`jev spend     $${jev.usd.toFixed(5)} over ${jev.requests} requests`);
