import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentUpdateV2, StructureUpdateV2, SurfaceUpdate } from '@jit/schema';
import { createGraph, createSession } from './graph.js';
import { startTurn, type TurnDeps } from './harness/turn.js';
import { stubContentSource } from './harness/clients/content.js';
import { OpenAiContentModel, stubContentModel } from './harness/clients/content-model.js';
import { getRealJevClient, stubJevClient } from './harness/clients/jev.js';
import { realResearchClient } from './harness/clients/research.js';

/**
 * Drives the real graph with utterances nobody scripted and prints what each
 * one actually decided.
 *
 *   npm run probe                          # the unscripted set below
 *   npm run probe -- "burn the cookies"    # your own, in one session
 *
 * **What this is for.** CLAUDE.md constraint 6 says the flow is never
 * hardcoded and that judges will drive the device themselves. That claim is
 * only worth anything if it is falsifiable, so this prints the DECISION behind
 * each surface — route, the policy rule that fired, template, whether styling
 * moved — not just the pixels. A lookup table pretending to be an orchestrator
 * shows up here as one template for every input.
 *
 * **It is deliberately honest about which layers are generated.** The six
 * projected surfaces are built by TypeScript from typed state, on purpose
 * (constraint 2: the model decides, code computes). So a green run here does
 * NOT mean "every pixel came from a model" — it means routing, template
 * choice and styling responded to an input nobody wrote down. The per-surface
 * line says which of the two produced the structure.
 */

const UNSCRIPTED = [
  'i want to bake something for my roommates',
  'make it high contrast, i can barely read it',
  'actually i dumped in way too much sugar',
  "what's the most expensive ingredient in here",
  'ok start over',
];

const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.TYPESAFE_API_KEY && process.env.JEV_API) process.env.TYPESAFE_API_KEY = process.env.JEV_API;

const hasJevKey = Boolean(process.env.TYPESAFE_API_KEY);
const contentKey = process.env.JIT_CONTENT_MODEL_KEY ?? process.env.OPENAI_KEY;

const jev = hasJevKey ? getRealJevClient() : stubJevClient;
const contentModel = contentKey ? new OpenAiContentModel() : stubContentModel;

if (!hasJevKey) {
  // The one result that would be a lie. A stub Jev answers `query` /
  // `generic_answer` at 0.5 for every input, which is exactly the "one
  // template for every utterance" signature of the hardcoding this probe
  // exists to detect — so it refuses rather than printing a false negative.
  console.error('PROBE ABORTED — no Jev key (TYPESAFE_API_KEY or JEV_API).');
  console.error('The stub answers identically for every utterance, so this run could not tell');
  console.error('a live router from a hardcoded one. Set the key and run again.');
  process.exit(1);
}

const utterances = process.argv.slice(2).length > 0 ? [process.argv.slice(2).join(' ')] : UNSCRIPTED;

// One session on purpose: a judge asks a follow-up, and `refine`/`correct`
// are only meaningful against a surface that is already up.
const session = createSession();
const deps: TurnDeps = {
  graph: createGraph(session),
  jev,
  content: stubContentSource,
  contentModel,
  fetch: realResearchClient,
  logPath: null,
};

const isStructure = (p: SurfaceUpdate): p is StructureUpdateV2 => 'spec' in p;
const isContent = (p: SurfaceUpdate): p is ContentUpdateV2 => 'values' in p && !('spec' in p);

const seenTemplates = new Set<string>();
const seenRoutes = new Set<string>();
const seenThemes = new Set<string>();

for (const utterance of utterances) {
  const before = session.currentTemplate;
  const started = performance.now();
  const turn = startTurn({ utterance }, deps);
  const patches: SurfaceUpdate[] = [];
  for await (const patch of turn.patches) patches.push(patch);
  const elapsed = Math.round(performance.now() - started);

  const log = turn.log.entries as readonly unknown[] as ReadonlyArray<Record<string, unknown>>;
  const policy = log.find((e) => e.kind === 'policy');
  const halted = log.find((e) => e.kind === 'halted');
  const skipped = log.find((e) => e.kind === 'paint-skipped');
  const faults = log.filter((e) => e.kind === 'fault');

  const structure = patches.find(isStructure);
  const content = patches.find(isContent);
  const style = patches.find((p) => 'theme' in p) as { theme?: Record<string, string> } | undefined;

  const template = (policy?.templateId as string | undefined) ?? (skipped?.templateId as string | undefined) ?? '—';
  if (template !== '—') seenTemplates.add(template);
  if (policy?.rule) seenRoutes.add(String(policy.rule));
  if (style?.theme) seenThemes.add(Object.values(style.theme).join('/'));

  console.log(`\n\u001b[1m"${utterance}"\u001b[0m`);
  console.log(`  was showing : ${before ?? '(nothing)'}`);
  console.log(`  template    : ${template}   rule=${String(policy?.rule ?? '—')}`);
  const applied = log.find((e) => e.kind === 'deviation-applied');
  const unapplied = log.find((e) => e.kind === 'deviation-unapplied');
  if (applied) console.log(`  correction  : ${String(applied.ingredient)} x${String(applied.factor)} -> bowl`);
  if (unapplied) console.log(`  correction  : ${String(unapplied.ingredient)} x${String(unapplied.factor)} NOT applied (no number for that label)`);
  console.log(`  bowl        : ${Object.entries(session.task.inBowl).map(([k, v]) => `${k}=${v}`).join(' ') || '(empty)'}`);
  console.log(`  styling     : ${style?.theme ? Object.entries(style.theme).map(([k, v]) => `${k}=${v}`).join(' ') : 'unchanged (Jev said the utterance was not a style ask)'}`);

  if (structure) {
    const types = Object.values(structure.spec.elements).map((el) => el.type);
    const tally = [...new Set(types)].map((t) => `${t}×${types.filter((x) => x === t).length}`).join(' ');
    console.log(`  structure   : PROJECTED from task state (code, no model) — ${types.length} elements: ${tally}`);
  } else if (skipped) {
    console.log(`  structure   : none — ${String(skipped.reason)}`);
  } else if (halted) {
    console.log(`  structure   : none — halted after ${String(halted.after)}`);
  }

  if (content) {
    const copy = Object.entries(content.values)
      .flatMap(([id, fields]) => Object.entries(fields).map(([f, v]) => `${id}.${f}=${JSON.stringify(v)}`))
      .slice(0, 4);
    console.log(`  copy        : ${copy.join(' · ')}${Object.keys(content.values).length > 4 ? ' …' : ''}`);
  }

  for (const note of log.filter((e) => e.kind === 'paint-warning')) {
    console.log(`  warning     : ${String(note.warning)}`);
  }
  for (const fault of faults) console.log(`  FAULT       : ${String(fault.node)} — ${String(fault.reason)}`);
  console.log(`  patches     : ${patches.length} in ${elapsed}ms`);
}

console.log('\n———');
console.log(`${utterances.length} utterance(s) -> ${seenTemplates.size} distinct template(s): ${[...seenTemplates].join(', ') || '(none)'}`);
console.log(`policy rules fired: ${[...seenRoutes].join(', ') || '(none)'}`);
console.log(`distinct themes emitted: ${seenThemes.size}`);
console.log(
  seenTemplates.size > 1
    ? 'Routing and template choice RESPONDED to the input — not one canned surface.'
    : 'Only one template across every input. Either the inputs were too similar, or the routing is not doing anything.',
);
console.log('Note: the projected surfaces above are built in TypeScript by design (constraint 2).');
console.log('What this run tested is whether the DECISIONS around them are live.');
