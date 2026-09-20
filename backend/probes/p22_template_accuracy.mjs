// How often does Jev pick the right SURFACE, on its own?
// Separates raw templateId accuracy from post-policy surface accuracy, because
// policy reconciles unreachable templates and would otherwise mask the model.
const D = '/Users/steric/work/03-Projects/htn/htn/apps/server/dist';
const { JevHttpClient } = await import(`${D}/harness/clients/jev.js`);
const { policy } = await import(`${D}/harness/nodes/policy.js`);
const { createStubCtx } = await import(`${D}/harness/ctx.js`);

// [utterance, currentTemplate, taskState, hasTask, expected surface]
const CASES = [
  ['I want to bake chocolate chip cookies tonight',  null,           'nothing started', false, 'choice_cards'],
  ['lets make some cookies tonight',                 null,           'nothing started', false, 'choice_cards'],
  ['what should I make for dessert',                 null,           'nothing started', false, 'choice_cards'],
  ['show me the recipe',              'choice_cards', 'classic chocolate chip open, 18 cookies, step 1 of 7', true,  'item_detail'],
  ['what are the ingredients',        'item_detail',  'classic chocolate chip open, 18 cookies, step 1 of 7', true,  'item_detail'],
  ['actually make it three times the batch', 'item_detail', 'classic chocolate chip open, 18 cookies, step 1 of 7', true, 'item_detail'],
  ['ok start baking',                 'item_detail',  'classic chocolate chip open, 54 cookies, step 1 of 7', true,  'focus_step'],
  ['what do I do now',                'focus_step',   'classic chocolate chip open, 54 cookies, step 3 of 7', true,  'focus_step'],
  ['next step',                       'focus_step',   'classic chocolate chip open, 54 cookies, step 3 of 7', true,  'focus_step'],
  ['I accidentally added twice as much sugar', 'focus_step', 'classic chocolate chip open, 54 cookies, step 3 of 7', true, 'recovery'],
  ['I put in way too much flour',     'focus_step',   'classic chocolate chip open, 54 cookies, step 4 of 7', true,  'recovery'],
  ['who could I give some to',        'summary_done', 'classic chocolate chip done, 108 cookies', true,  'people_picker'],
  ['who lives closest to me',         'summary_done', 'classic chocolate chip done, 108 cookies', true,  'people_picker'],
  ['make it easier to read',          'focus_step',   'classic chocolate chip open, 54 cookies, step 3 of 7', true,  'focus_step'],
  ['how long do I boil an egg',       null,           'nothing started', false, 'generic_answer'],
];

const jev = new JevHttpClient({ maxUsd: 1.0 });
const ctx = createStubCtx(new AbortController().signal);
let rawOk = 0, sysOk = 0;
const rows = [];

for (const [utterance, currentTemplate, taskState, hasTask, expected] of CASES) {
  const a = await jev.ask({ utterance, currentTemplate, taskState }, AbortSignal.timeout(6000));
  const raw = a.templateId.value;
  const p = await policy.run({
    route: a.route.value, jevTemplateId: raw, currentTemplate, hasTask,
    hasDeviation: /too much|twice as much|way too/.test(utterance),
  }, ctx);
  const rawHit = raw === expected, sysHit = p.templateId === expected;
  if (rawHit) rawOk++; if (sysHit) sysOk++;
  rows.push({ utterance, route: a.route.value, rc: a.route.confidence,
    raw, rc2: a.templateId.confidence, sys: p.templateId, rule: p.rule, expected, rawHit, sysHit });
}

console.log('\n' + 'utterance'.padEnd(42) + 'route'.padEnd(10) + 'jev says'.padEnd(16) + 'conf  system shows'.padEnd(20) + '  expected');
console.log('-'.repeat(118));
for (const r of rows) console.log(
  r.utterance.slice(0,40).padEnd(42) + r.route.padEnd(10) +
  ((r.rawHit?'✓ ':'✗ ') + r.raw).padEnd(16) + r.rc2.toFixed(2).padEnd(6) +
  ((r.sysHit?'✓ ':'✗ ') + r.sys).padEnd(20) + r.expected);
console.log(`\nJev's templateId alone : ${rawOk}/${CASES.length}`);
console.log(`What the system shows  : ${sysOk}/${CASES.length}`);
const low = rows.filter(r => r.rc2 < 0.6).length;
console.log(`templateId confidence below 0.60: ${low}/${CASES.length}`);
console.log(`spend $${jev.usd.toFixed(5)} over ${jev.requests} requests`);
