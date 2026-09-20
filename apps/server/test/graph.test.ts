import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ContentUpdateSchema,
  StructureUpdateSchema,
  type ContentUpdateV2,
  type StructureUpdateV2,
  type SurfaceUpdate,
} from '@jit/schema';
import { buildGraph } from '../src/graph.js';
import { createSession, type Session } from '../src/session.js';
import { createReplayJevClient, parseJevResponse, type JevWireResponse } from '../src/harness/clients/jev.js';
import { stubContentSource } from '../src/harness/clients/content.js';
import { createTurnRunner, startTurn, type Turn } from '../src/harness/turn.js';
import type { ContentSource, Event, JevClient } from '../src/harness/types.js';
import { sleep } from '../src/harness/signal.js';
import { fixtureComposer } from '../src/contract/compose.js';
import { currentYield, findDeviations } from '../src/domain/recipe.js';

/**
 * The concrete graph, driven offline.
 *
 * Every Jev answer here comes from a RECORDED fixture parsed through the same
 * `parseJevResponse` the live client uses, so replay exercises the parse path
 * rather than a hand-typed `JevAnswer`. No network, no subprocess, no socket.
 */

// Not `new URL(`...${x}`, import.meta.url)`: Vite statically rewrites that
// two-argument form and resolves a dynamic first argument to ".../undefined".
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixture = (path: string): string => join(FIXTURES, path);

/** `new_task` -> `choice_cards`: a projected surface, so zero model calls after `decide`. */
const NEW_TASK = fixture('jev/recorded/new_task.json');

type Harness = {
  session: Session;
  events: Event[];
  say(input: unknown): Turn;
};

function harness(options: { jev?: JevClient; content?: ContentSource; session?: Session } = {}): Harness {
  const session = options.session ?? createSession();
  const events: Event[] = [];
  const graph = buildGraph({ session });
  return {
    session,
    events,
    say(input: unknown): Turn {
      return startTurn(input, {
        graph,
        jev: options.jev ?? createReplayJevClient(NEW_TASK),
        content: options.content ?? stubContentSource,
        logPath: null,
        telemetry: (event) => events.push(event),
      });
    },
  };
}

const drain = async (turn: Turn): Promise<SurfaceUpdate[]> => {
  const out: SurfaceUpdate[] = [];
  for await (const update of turn.patches) out.push(update);
  return out;
};

const isStructure = (u: SurfaceUpdate): u is StructureUpdateV2 => 'stage' in u && u.stage === 'structure';
const isContent = (u: SurfaceUpdate): u is ContentUpdateV2 => 'stage' in u && u.stage === 'content';

/** Node names `timed()` reports, i.e. the harness nodes that actually RAN. */
const ranNodes = (events: Event[]): string[] => events.filter((e) => e.kind === 'node').map((e) => e.node);

/**
 * Which GRAPH nodes the turn entered.
 *
 * Not the same question as `ranNodes`, and the difference is the whole point:
 * every node guards its own preconditions and returns `{halted: true}` before
 * `runGuarded`, so a graph with its conditional edges deleted still reports
 * one fault and one run node. It just ENTERS four more of them, on a turn
 * that is already over. Only this can see that.
 */
const enteredNodes = (turn: Turn): string[] =>
  turn.log.entries.filter((e) => e.kind === 'node-enter').map((e) => String(e.node));

describe('graph: a turn end to end', () => {
  it('paints a projected surface: structure and content both reach the sink', async () => {
    const h = harness();

    const updates = await drain(h.say({ utterance: 'what should I make tonight' }));

    const structure = updates.filter(isStructure);
    const content = updates.filter(isContent);
    expect(structure).toHaveLength(1);
    expect(content).toHaveLength(1);

    // Parsed, not shape-guessed: a wrong literal in a spec fails silently
    // here and loudly on the device.
    const spec = StructureUpdateSchema.parse(structure[0]);
    const values = ContentUpdateSchema.parse(content[0]);
    expect(spec.status).toBe('complete');
    expect(values.complete).toBe(true);
    // The two halves must name the same generation, or the device applies
    // content to a surface that is no longer there.
    expect(values.requestId).toBe(spec.requestId);
    expect(values.generationId).toBe(spec.generationId);

    // The projected composer produced the copy itself — no model call.
    expect(ranNodes(h.events)).not.toContain('content');
    expect(Object.keys(values.values).length).toBeGreaterThan(0);
    for (const elementId of Object.keys(values.values)) expect(spec.spec.elements[elementId]).toBeDefined();
  });

  it('threads the session across turns, so a press means something', async () => {
    const h = harness();

    await drain(h.say({ utterance: 'what should I make tonight' }));
    expect(h.session.surface).toBe('choice_cards');
    expect(h.session.task).toBeNull();

    // `events` accumulates across turns; only this turn's are interesting.
    const before = h.events.length;
    const updates = await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));

    expect(h.session.surface).toBe('item_detail');
    expect(h.session.task?.recipe.id).toBe('classic_choc_chip');
    expect(updates.filter(isStructure)).toHaveLength(1);
    // A press never reaches a model — a control must respond within a frame.
    // `act` and `project` only. No `decide`, and no `content` either — the
    // projected composer returned the copy with the structure.
    expect(ranNodes(h.events.slice(before))).toEqual(['act', 'project']);
  });

  it('refuses an action it has no mapping for rather than painting something plausible', async () => {
    const h = harness();
    const turn = h.say({ action: 'launch_the_missiles', elementId: 'nope' });

    const updates = await drain(turn);

    expect(updates).toEqual([]);
    expect(h.session.surface).toBeNull();
    expect(turn.log.entries.some((e) => e.kind === 'action-refused')).toBe(true);
  });
});

describe('graph: a failed decide halts the graph', () => {
  const exploding: JevClient = {
    async ask(): Promise<never> {
      throw new Error('jev: black hole');
    },
  };

  /**
   * `runGuarded` returning `{ok:false}` does NOT stop the graph
   * (`graph-runtime.ts`). Without the `halted` flag and a conditional edge to
   * `END` after every node that can fail, `policy`, `style`, `structure` and
   * `content` all run on state `decide` never produced and each file their
   * own fault — four faults describing one failure.
   *
   * Break-the-test check performed: replacing
   * `.addConditionalEdges('decide', stop('policy'), ...)` with a plain
   * `.addEdge('decide', 'policy')` makes `enteredNodes` come back as
   * `['decide','policy']` and this fails. The fault count and `ranNodes`
   * alone do NOT fail — they are satisfied by the per-node guards — which is
   * exactly why `enteredNodes` is asserted. (It leaks one node rather than
   * four because `policy`'s own conditional edge then catches the halt the
   * guard set: every edge is individually load-bearing.)
   */
  it('enters no node after decide, files exactly one fault, and paints nothing', async () => {
    const h = harness({ jev: exploding });
    const turn = h.say({ utterance: 'anything at all' });

    const updates = await drain(turn);

    expect(updates).toEqual([]);
    expect(enteredNodes(turn)).toEqual(['decide']);
    expect(ranNodes(h.events)).toEqual(['decide']);

    const faults = h.events.filter((e) => e.kind === 'fault');
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ node: 'decide', reason: 'decide-degraded' });

    // The named degraded state is in the log, not hidden (constraint 5).
    expect(turn.log.entries.some((e) => e.kind === 'decide-degraded')).toBe(true);
    expect(turn.log.entries.some((e) => e.kind === 'structure-emitted')).toBe(false);
  });

  it('leaves the session exactly as it was', async () => {
    const h = harness();
    await drain(h.say({ utterance: 'what should I make tonight' }));
    const before = h.session.surface;

    const broken = harness({ jev: exploding, session: h.session });
    await drain(broken.say({ utterance: 'anything at all' }));

    expect(h.session.surface).toBe(before);
  });
});

describe('graph: a turn started without an input', () => {
  /**
   * The graph's entry state is a single `input` channel. A caller that hands
   * `startTurn` something else gets the channel's DEFAULT, which LangGraph
   * supplies silently — that is how an empty utterance reached live Jev once
   * and came back with a plausible surface. It must refuse instead.
   */
  it('refuses by name rather than classifying a default', async () => {
    const h = harness();
    const turn = h.say({ nonsense: true });

    const updates = await drain(turn);

    expect(updates).toEqual([]);
    expect(ranNodes(h.events)).toEqual([]);
    expect(turn.log.entries.some((e) => e.kind === 'input-missing')).toBe(true);
  });
});

describe('graph: barge-in', () => {
  /** A `decide` slow enough for a second utterance to land inside it. */
  const slowJev = (inner: JevClient, ms: number): JevClient => ({
    async ask(state, signal) {
      await sleep(ms, signal);
      return inner.ask(state, signal);
    },
  });

  /**
   * `createTurnRunner.say` is the thing under test, not `Turn.abort`: a
   * second utterance must abort the first BY ITSELF. Calling `first.abort()`
   * in the test would prove only that `abort` works.
   *
   * Break-the-test check performed: removing `active?.abort(...)` from
   * `createTurnRunner.say` makes the first turn paint its structure and
   * content and records no `abort`, and this fails on both assertions.
   *
   * The websocket half of done-when 6 lives in `graph-ws.test.ts`. Note that
   * the socket property survives this break on its own, because `pump` also
   * drops updates from a superseded turn — two independent defences, which is
   * why the abort needs proving here rather than there.
   */
  it('a second utterance aborts the first, which paints nothing and stops spending', async () => {
    const jev = slowJev(createReplayJevClient(NEW_TASK), 200);
    const session = createSession();
    const runner = createTurnRunner({ graph: buildGraph({ session }), jev, content: stubContentSource, logPath: null });

    const first = runner.say({ utterance: 'what should I make tonight' });
    const firstUpdates: SurfaceUpdate[] = [];
    const firstDone = (async () => {
      for await (const update of first.patches) firstUpdates.push(update);
    })();

    await sleep(40, new AbortController().signal);
    const second = runner.say({ utterance: 'what should I make tonight' });
    const secondUpdates = await drain(second);
    await firstDone;

    expect(firstUpdates).toEqual([]);
    expect(first.log.entries.some((e) => e.kind === 'abort')).toBe(true);
    // The interrupted turn stopped at `decide` — it never reached a composer.
    expect(enteredNodes(first)).toEqual(['decide']);

    // The one that finished did the work, and the session reflects only it.
    expect(secondUpdates.filter(isStructure)).toHaveLength(1);
    expect(session.surface).toBe('choice_cards');
  });
});

/* ------------------------------------------------------------------ *
 * The beats that are not a straight line
 * ------------------------------------------------------------------ */

/**
 * A recorded wire response with individual answers overridden, parsed through
 * the same `parseJevResponse` the live client uses.
 *
 * Preferable to a new hand-written fixture: the shape stays a real recorded
 * one, and the override is visible at the call site rather than buried in a
 * JSON file that looks recorded and is not. `correct.json`'s own
 * `deviationFactor` is `other` at 0.38 — an honest answer that carries no
 * number, so it cannot exercise the arithmetic.
 */
function editedJev(path: string, answers: Record<string, unknown>): JevClient {
  const fx = JSON.parse(readFileSync(path, 'utf8')) as { response: JevWireResponse };
  const response = { ...fx.response, answers: { ...fx.response.answers, ...answers } as JevWireResponse['answers'] };
  return {
    async ask(_state, signal) {
      await sleep(0, signal);
      return parseJevResponse(response);
    },
  };
}

const choiceAnswer = (choice: string, confidence = 0.9): unknown => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const noulAnswer = (p: number): unknown => ({ type: 'noul', noul: p });

/** The session mid-bake: creaming done, so the bowl holds something to deviate from. */
async function baking(): Promise<Harness> {
  const h = harness();
  await drain(h.say({ utterance: 'what should I make tonight' }));
  await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));
  await drain(h.say({ action: 'begin', elementId: 'start' }));
  await drain(h.say({ action: 'next_step', elementId: 'next' }));
  return h;
}

const offline = (session: Session, jev: JevClient): Parameters<typeof startTurn>[1] => ({
  graph: buildGraph({ session }),
  jev,
  content: stubContentSource,
  logPath: null,
});

describe('graph: the recovery beat', () => {
  /**
   * The chicken-and-egg that `findDeviations(session.task)` alone walks into:
   * at the moment the user SAYS the sugar went in twice, the session still
   * believes the bowl matches the plan — the deviation is the thing being
   * reported. Asking the un-corrected state sends the turn to `correct_keep`
   * and the recovery surface never appears.
   */
  it('routes a correction to recovery by asking the CORRECTED state', async () => {
    const h = await baking();
    expect(findDeviations(h.session.task!)).toEqual([]);

    const jev = editedJev(fixture('jev/recorded/correct.json'), { deviationFactor: choiceAnswer('2x') });
    const turn = startTurn({ utterance: 'I accidentally added twice as much sugar' }, offline(h.session, jev));
    const out = await drain(turn);

    expect(turn.log.entries.find((e) => e.kind === 'policy')).toMatchObject({ rule: 'correct_recovery', surface: 'recovery' });
    expect(out.filter(isStructure)).toHaveLength(1);
    // The correction is a FACT about the bowl, not a proposal: it persists, or
    // the `apply_fix` press that follows plans against an undeviated state and
    // does nothing.
    expect(h.session.task!.inBowl.caster_sugar).toBe(1.5);
    expect(findDeviations(h.session.task!)[0]).toMatchObject({ id: 'caster_sugar', factor: 2 });
  });

  /**
   * `DEVIATION_FACTORS.other` is `null` on purpose: the model classified that
   * none of the fixed buckets fits, so there is no number to compute with, and
   * constraint 2 forbids taking one from the model. The turn keeps the surface
   * rather than inventing a factor.
   */
  it('keeps the current surface when the factor bucket carries no number', async () => {
    const h = await baking();
    const jev = editedJev(fixture('jev/recorded/correct.json'), { deviationFactor: choiceAnswer('other', 0.38) });
    const turn = startTurn({ utterance: 'the sugar was a bit off' }, offline(h.session, jev));

    await drain(turn);

    expect(turn.log.entries.find((e) => e.kind === 'policy')).toMatchObject({ rule: 'correct_keep' });
    expect(h.session.task!.inBowl.caster_sugar).toBe(0.75);
  });

  it('press apply_fix scales the whole batch, and is idempotent', async () => {
    const h = await baking();
    const jev = editedJev(fixture('jev/recorded/correct.json'), { deviationFactor: choiceAnswer('2x') });
    await drain(startTurn({ utterance: 'twice as much sugar' }, offline(h.session, jev)));

    await drain(h.say({ action: 'apply_fix', elementId: 'fix' }));
    expect(currentYield(h.session.task!)).toBe(36);

    // A judge will press it twice.
    const again = h.say({ action: 'apply_fix', elementId: 'fix' });
    expect(await drain(again)).toEqual([]);
    expect(again.log.entries.some((e) => e.kind === 'action-refused')).toBe(true);
    expect(currentYield(h.session.task!)).toBe(36);
  });
});

describe('graph: the save/track beat', () => {
  /**
   * `grocery_added` is not a `TemplateId` (`packages/schema` is frozen), so
   * Jev reaches it through its own `noul` rather than through the tuned
   * eight-option `templateId` question. Nothing in the graph reads the word
   * "grocery" out of the utterance — set the noul false and the same utterance
   * lands wherever `templateId` says.
   */
  it('projects grocery_added when the save gate is true and a task is open', async () => {
    const h = harness();
    await drain(h.say({ utterance: 'what should I make tonight' }));
    await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));

    const jev = editedJev(fixture('jev/recorded/new_task.json'), { wantsSaved: noulAnswer(0.95) });
    const turn = startTurn({ utterance: 'add these to my grocery list' }, offline(h.session, jev));
    const out = await drain(turn);

    expect(turn.log.entries.find((e) => e.kind === 'structure-emitted')).toMatchObject({ surface: 'grocery_added' });
    const content = ContentUpdateSchema.parse(out.filter(isContent)[0]);
    // Every dollar came from `estimateCost`, computed in TypeScript: the five
    // ingredients the seeded pantry does not already stock, at one batch.
    // 1.56 + 0.29 + 0.33 + 0.30 + 1.44 — rounded PER LINE before summing, so
    // the total agrees with the rows above it.
    expect(content.values.spend).toMatchObject({ value: '$3.92', delta: '5 of 9 items' });
  });

  it('ignores the save gate when there is nothing open to save', async () => {
    const h = harness();
    const jev = editedJev(fixture('jev/recorded/new_task.json'), { wantsSaved: noulAnswer(0.95) });
    const turn = startTurn({ utterance: 'add these to my grocery list' }, offline(h.session, jev));

    await drain(turn);

    expect(turn.log.entries.find((e) => e.kind === 'structure-emitted')).toMatchObject({ surface: 'choice_cards' });
  });
});

/** A minimal already-composed surface: one bound element, nothing else. */
const composedFixture = (): StructureUpdateV2 =>
  StructureUpdateSchema.parse({
    v: 2,
    stage: 'structure',
    requestId: 'composed-fixture',
    generationId: 'composed-fixture',
    maxWidth: 640,
    status: 'complete',
    spec: {
      root: 'card',
      elements: {
        card: { type: 'Card', props: {}, children: ['lede'] },
        lede: { type: 'Heading', props: { id: 'lede', level: 1, pending: { $state: '/content/lede/pending' }, text: { $state: '/content/lede/text' } } },
      },
      state: { content: { lede: { pending: true, text: '' } } },
    },
  });

describe('graph: an open-ended surface', () => {
  const generic = (): JevClient => editedJev(fixture('jev/recorded/new_task.json'), { templateId: choiceAnswer('generic_answer') });

  it('reports that it cannot compose rather than painting a projected surface instead', async () => {
    const session = createSession();
    // No composer wired: the honest outcome is nothing painted and a reason.
    const turn = startTurn({ utterance: 'how long do I boil an egg' }, offline(session, generic()));

    const out = await drain(turn);

    expect(out).toEqual([]);
    expect(turn.log.entries.find((e) => e.kind === 'structure-unavailable')).toMatchObject({ surface: 'generic_answer' });
    expect(session.surface).toBeNull();
    // The halt edge after `structure` is load-bearing too: `content` is never
    // entered. Break-the-test check performed — replacing that conditional
    // edge with `.addEdge('structure', 'content')` fails here.
    expect(enteredNodes(turn)).toEqual(['decide', 'policy', 'style', 'structure']);
  });

  /**
   * ADR 0001's added invariant: "the surface must reach a resolved state on
   * every path; never a permanent shimmer." `stubContentSource` speaks the
   * RETIRED slot protocol, so it is a realistic malformed response — and the
   * content update must still arrive, with every target rejected, so the
   * device clears `pending` and shows placeholders instead of shimmering
   * forever. Nothing is invented to fill them.
   */
  it('still resolves every element when content generation fails', async () => {
    const session = createSession();
    const events: Event[] = [];
    const turn = startTurn({ utterance: 'how long do I boil an egg' }, {
      graph: buildGraph({ session, composer: fixtureComposer(composedFixture()) }),
      jev: generic(),
      content: stubContentSource,
      logPath: null,
      telemetry: (e) => events.push(e),
    });

    const out = await drain(turn);

    const content = ContentUpdateSchema.parse(out.filter(isContent)[0]);
    expect(Object.keys(content.values)).toEqual(['lede']);
    // Rejected, so field-less — `applyContent` clears `pending` for every key
    // in `values`, which is what stops the shimmer.
    expect(content.values.lede).toEqual({});
    expect(events.some((e) => e.kind === 'generate-fault')).toBe(true);
  });
});

describe('graph: the bowl only fills once', () => {
  /**
   * Found by pressing Back and then Next against the live driver, not by
   * reasoning: `completeStep` puts a step's ingredients in the bowl, and
   * `prev_step` cannot take them out again — you cannot un-add flour. Without
   * `Session.filledTo` the creaming step's butter and sugars go in a second
   * time and the bowl silently drifts off plan, which then makes `recovery`
   * offer a scale-up nobody asked for.
   */
  it('stepping back and forward again moves the cursor and nothing else', async () => {
    const h = await baking();
    const filled = { ...h.session.task!.inBowl };
    expect(filled.butter).toBe(1);

    await drain(h.say({ action: 'prev_step', elementId: 'prev' }));
    await drain(h.say({ action: 'next_step', elementId: 'next' }));

    expect(h.session.task!.inBowl).toEqual(filled);
    expect(findDeviations(h.session.task!)).toEqual([]);
  });
});

describe('graph: every surface is reachable by a real classification', () => {
  /**
   * The demo has no script, so a surface that can only be reached by a
   * hardcoded step is not finished (CLAUDE.md constraint 6). Each projected
   * surface here is reached the way it is reached live: by what Jev answered,
   * or by a control the previous surface really offered.
   *
   * `message_drafts` and `generic_answer` are composed rather than projected
   * and are covered by "an open-ended surface" above.
   */
  const reach: { surface: string; run: (h: Harness) => Promise<void> }[] = [
    { surface: 'choice_cards', run: async (h) => { await drain(h.say({ utterance: 'what should I make tonight' })); } },
    {
      surface: 'item_detail',
      run: async (h) => {
        await drain(h.say({ utterance: 'what should I make tonight' }));
        await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));
      },
    },
    { surface: 'focus_step', run: async (h) => { await baking2(h); } },
    {
      surface: 'summary_done',
      run: async (h) => {
        await baking2(h);
        await drain(h.say({ action: 'step_done', elementId: 'next' }));
      },
    },
    {
      surface: 'people_picker',
      run: async (h) => {
        await baking2(h);
        await drain(h.say({ action: 'share', elementId: 'share' }));
      },
    },
  ];

  const baking2 = async (h: Harness): Promise<void> => {
    await drain(h.say({ utterance: 'what should I make tonight' }));
    await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));
    await drain(h.say({ action: 'begin', elementId: 'start' }));
  };

  for (const { surface, run } of reach) {
    it(`reaches ${surface}`, async () => {
      const h = harness();
      await run(h);
      expect(h.session.surface).toBe(surface);
    });
  }

  it('reaches recovery, and grocery_added, without either being a step', async () => {
    // Both come from a typed Jev answer against whatever is open — `recovery`
    // from the `correct` route plus a deviation that carries a number,
    // `grocery_added` from its own `noul`. Neither is positional.
    const h = await baking();
    const recovery = startTurn({ utterance: 'that was twice as much sugar' }, offline(h.session, editedJev(fixture('jev/recorded/correct.json'), { deviationFactor: choiceAnswer('2x') })));
    await drain(recovery);
    expect(h.session.surface).toBe('recovery');

    const grocery = startTurn({ utterance: 'put that on my list' }, offline(h.session, editedJev(fixture('jev/recorded/new_task.json'), { wantsSaved: noulAnswer(0.9) })));
    await drain(grocery);
    expect(h.session.surface).toBe('grocery_added');
  });
});

describe('graph: "actually make it three times the batch"', () => {
  const refineBy = (bucket: string): JevClient =>
    editedJev(fixture('jev/recorded/refine.json'), { batchFactor: choiceAnswer(bucket, 1) });

  /**
   * The demo's most likely unscripted sentence, and the one the route criteria
   * were re-tuned for. Routing it correctly is not enough on its own: `refine`
   * is `refine_keep`, so the surface re-projects — and if nothing carries the
   * amount, a judge says it and watches 18 cookies stay 18.
   *
   * The amount arrives as a BUCKET and `setYield` computes from it, which is
   * the same split as the recovery beat. Measured live at `batchFactor: 3x`,
   * confidence 1.00.
   */
  it('rescales the whole recipe from a typed bucket', async () => {
    const h = harness();
    await drain(h.say({ utterance: 'what should I make tonight' }));
    await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));
    expect(currentYield(h.session.task!)).toBe(18);

    const turn = startTurn({ utterance: 'actually make it three times the batch' }, offline(h.session, refineBy('3x')));
    const out = await drain(turn);

    expect(currentYield(h.session.task!)).toBe(54);
    // Every number on the surface moved with it, computed in `domain/`.
    const content = ContentUpdateSchema.parse(out.filter(isContent)[0]);
    expect(content.values.subtitle?.text).toContain('54 cookies');
  });

  /**
   * Most refines are not about the amount. `unchanged` is a real option for
   * exactly that reason — without it the model must pick a multiplier every
   * time, which is the failure `wantsStyleChange` exists to prevent (p14).
   * Measured live: "make this easier to read from far away" comes back
   * `unchanged` at 0.97.
   */
  it('leaves the batch alone when the refine is about the look', async () => {
    const h = harness();
    await drain(h.say({ utterance: 'what should I make tonight' }));
    await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));

    await drain(startTurn({ utterance: 'make this easier to read from far away' }, offline(h.session, refineBy('unchanged'))));

    expect(currentYield(h.session.task!)).toBe(18);
  });

  /**
   * `setYield` moves `scale` and the bowl does not move with it, so rescaling
   * mid-bake would make everything already added read as a deviation and hand
   * the user a recovery beat they did not cause. Same asymmetry as
   * `planScaleUp`: you cannot un-add flour.
   */
  it('refuses to rescale once anything is in the bowl, and says why', async () => {
    const h = await baking();
    const before = currentYield(h.session.task!);

    const turn = startTurn({ utterance: 'actually make it half' }, offline(h.session, refineBy('half')));
    await drain(turn);

    expect(currentYield(h.session.task!)).toBe(before);
    expect(findDeviations(h.session.task!)).toEqual([]);
    const policy = turn.log.entries.find((e) => e.kind === 'policy');
    expect(JSON.stringify(policy?.warnings)).toContain('already in the bowl');
  });

  /** `other` carries no number by construction, so there is nothing to compute with. */
  it('ignores a bucket that carries no number', async () => {
    const h = harness();
    await drain(h.say({ utterance: 'what should I make tonight' }));
    await drain(h.say({ action: 'select_classic_choc_chip', elementId: 'option_1' }));

    await drain(startTurn({ utterance: 'make it a weird amount' }, offline(h.session, refineBy('other'))));

    expect(currentYield(h.session.task!)).toBe(18);
  });
});
