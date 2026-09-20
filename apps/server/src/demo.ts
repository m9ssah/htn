import type { ContentUpdateV2, StructureUpdateV2, SurfaceUpdate } from '@jit/schema';
import { buildGraph, liveComposer, type TurnInput } from './graph.js';
import { realContentSource } from './harness/clients/content.js';
import { getRealJevClient } from './harness/clients/jev.js';
import { createTurnRunner } from './harness/turn.js';
import { createSession } from './session.js';

/**
 * The demo driver.
 *
 *   npm run demo
 *
 * **Scripted utterances, real pipeline.** The eight beats below are the words
 * and presses a person performs; everything downstream of them is the same
 * graph `npm run serve` runs — live Jev for the route, the style axes and the
 * save gate, the real policy, the real composers, the real turn transport.
 * Nothing here branches on which beat it is in, nothing is canned, and no
 * surface is hardcoded: delete a beat and the rest still work, because each
 * one is a function of the session's typed state.
 *
 * Presses are resolved FROM THE SURFACE that was just painted — `press(/Classic/)`
 * finds the row whose generated copy matches and fires the action that row
 * declares. A hardcoded action name would be a hardcoded flow; reading the
 * action off the spec is what the hardware rail does.
 *
 * Seed data (the recipe, the price table, the pantry, the contacts) is a demo
 * account and is labelled as one in `seed.ts` and `domain/recipes.ts`. The
 * FLOW is not seeded (CLAUDE.md constraint 6).
 *
 * Live Jev costs roughly $0.00006 a call.
 */

const jev = getRealJevClient();
const session = createSession();
const graph = buildGraph({ session, composer: liveComposer(jev) });
const runner = createTurnRunner({ graph, jev, content: realContentSource, logPath: 'turns.jsonl' });

type Outcome = {
  n: string;
  label: string;
  route: string;
  surface: string;
  elements: string;
  ms: number;
  note: string;
};

const rows: Outcome[] = [];
let last: { structure: StructureUpdateV2 | null; content: ContentUpdateV2 | null } = { structure: null, content: null };

const isStructure = (u: SurfaceUpdate): u is StructureUpdateV2 => 'stage' in u && u.stage === 'structure';
const isContent = (u: SurfaceUpdate): u is ContentUpdateV2 => 'stage' in u && u.stage === 'content';

/**
 * `input` is a thunk because a press is resolved from the surface the
 * PREVIOUS beat painted — and because a press that finds nothing must record
 * a row and let the rest of the demo run, not take the process down. A demo
 * that dies on beat 4 tells you less than one that prints eight rows with one
 * of them marked.
 */
async function beat(n: string, label: string, input: TurnInput | (() => TurnInput)): Promise<void> {
  let resolved: TurnInput;
  try {
    resolved = typeof input === 'function' ? input() : input;
  } catch (err) {
    rows.push({ n, label, route: 'press', surface: '—', elements: '0', ms: 0, note: String((err as Error).message).slice(0, 90) });
    return;
  }
  const t0 = performance.now();
  const turn = runner.say(resolved);
  const updates: SurfaceUpdate[] = [];
  let error = '';
  try {
    for await (const update of turn.patches) updates.push(update);
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 60);
  }
  const ms = Math.round(performance.now() - t0);

  const entries = turn.log.entries;
  const jevLine = entries.find((e) => e.kind === 'jev');
  const structureLine = entries.find((e) => e.kind === 'structure-emitted');
  const unavailable = entries.find((e) => e.kind === 'structure-unavailable' || e.kind === 'decide-degraded' || e.kind === 'action-refused');

  const structure = updates.filter(isStructure).at(-1) ?? null;
  const content = updates.filter(isContent).at(-1) ?? null;
  if (structure) last = { structure, content };

  rows.push({
    n,
    label,
    route: jevLine ? `${String(jevLine.route)}(${Number(jevLine.routeConfidence).toFixed(2)})` : 'press',
    surface: structureLine ? String(structureLine.surface) : '—',
    elements: structure ? String(Object.keys(structure.spec.elements).length) : '0',
    ms,
    note: error || (unavailable ? `${unavailable.kind}: ${String(unavailable.reason ?? '')}`.slice(0, 58) : sample(structure, content)),
  });
}

/**
 * Two lines of the copy that actually landed, so the numbers on the surface
 * are in the transcript rather than taken on trust. Every one of them was
 * computed in `domain/` — none was produced by a model (constraint 2).
 */
const SAMPLE_KEYS = ['progress', 'instruction', 'title', 'subtitle', 'diagnosis', 'plan', 'outcome', 'result', 'spend'];

function sample(structure: StructureUpdateV2 | null, content: ContentUpdateV2 | null): string {
  if (!structure || !content) return '';
  const lines: string[] = [];
  for (const key of SAMPLE_KEYS) {
    const value = content.values[key];
    if (!value) continue;
    const parts = [value.label, value.value, value.text, value.delta].filter((v): v is string => typeof v === 'string' && v !== '');
    if (parts.length > 0) lines.push(parts.join(' '));
    if (lines.length === 2) break;
  }
  return lines.join('  |  ').slice(0, 104);
}

/**
 * Fires the action the painted surface declares for the row whose copy
 * matches — the same thing pressing the button would do.
 */
function press(match: RegExp): TurnInput {
  const { structure, content } = last;
  if (!structure || !content) throw new Error(`press(${match}): nothing is on screen`);
  for (const [elementId, element] of Object.entries(structure.spec.elements)) {
    const action = element.on?.press?.action ?? element.on?.range?.action;
    if (!action) continue;
    const values = content.values[elementId] ?? {};
    const copy = Object.values(values).filter((v): v is string => typeof v === 'string').join(' ');
    if (match.test(copy) || match.test(action)) return { action, elementId };
  }
  const available = Object.entries(structure.spec.elements)
    .map(([id, e]) => e.on?.press?.action ?? e.on?.range?.action ?? null)
    .filter((a): a is string => a !== null);
  throw new Error(`press(${match}): no match on the current surface. Available: ${available.join(', ')}`);
}

/** True when the painted surface offers this action at all. */
function offers(action: string): boolean {
  const structure = last.structure;
  if (!structure) return false;
  return Object.values(structure.spec.elements).some((e) => (e.on?.press?.action ?? e.on?.range?.action) === action);
}

/* ------------------------------------------------------------------ *
 * The eight beats
 * ------------------------------------------------------------------ */

try {
  await jev.warmup();
} catch (err) {
  process.stderr.write(`jev warmup failed (the first beat will pay the handshake): ${String(err)}\n`);
}

await beat('1', '"I want to bake chocolate chip cookies tonight. Something easy."', {
  utterance: 'I want to bake chocolate chip cookies tonight. Something easy.',
});

await beat('2', '(press Classic)', () => press(/Classic/));

await beat('3', '"Add these to my grocery list, and the prices to my spending tracker."', {
  utterance: 'Add these to my grocery list, and add the prices to my spending tracker.',
});

// The confirmation surface is a detour off the recipe; getting back to the
// recipe is a press it offers, not a step the script knows about.
if (!offers('begin') && offers('back_to_recipe')) await beat('3b', '(press Back to the recipe)', () => press(/^back_to_recipe$/));

await beat('4', '(press Start cooking)', () => press(/^begin$/));
// One step of actual baking, so the bowl holds something to deviate FROM.
// Driven by what the step surface offers, not by a step number.
if (offers('next_step')) await beat('4b', '(press Next)', () => press(/^next_step$/));

await beat('5', '"Wait, I accidentally added twice as much sugar."', {
  utterance: 'Wait, I accidentally added twice as much sugar.',
});

await beat('6', '(press Scale up)', () => press(/^apply_fix$/));

// Back to the steps and through to the end — the loop reads the surface each
// time and stops when the surface stops offering another step.
if (offers('begin')) await beat('7a', '(press Start cooking)', () => press(/^begin$/));
let guard = 0;
while (offers('next_step') && guard < 20) {
  guard += 1;
  await beat(`7.${guard}`, '(press Next)', () => press(/^next_step$/));
}
if (offers('step_done')) await beat('7', '(press Done)', () => press(/^step_done$/));

await beat('8', '"Who could I give some to?"', { utterance: 'Who could I give some to?' });

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

const head = `${'#'.padEnd(5)}${'input'.padEnd(66)}${'route'.padEnd(16)}${'surface'.padEnd(15)}${'els'.padEnd(5)}ms`;
console.log(`\n${head}`);
console.log('-'.repeat(head.length + 4));
for (const row of rows) {
  console.log(
    row.n.padEnd(5) +
      row.label.slice(0, 64).padEnd(66) +
      row.route.padEnd(16) +
      row.surface.padEnd(15) +
      row.elements.padEnd(5) +
      String(row.ms),
  );
  if (row.note) console.log(`     ${row.note}`);
}

const painted = rows.filter((r) => r.surface !== '—').length;
console.log(`\n${painted}/${rows.length} beats painted a surface`);
console.log(`jev spend  $${jev.usd.toFixed(5)} over ${jev.requests} requests`);
console.log('turn log   turns.jsonl (one JSONL line per turn; grep a turnId for the whole turn)');
