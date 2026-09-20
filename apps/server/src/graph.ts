import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { ContentUpdateV2, StructureUpdateV2, StylePatch, TemplateId } from '@jit/schema';
import { runGuarded, runtimeOf, type TurnRuntime } from './harness/graph-runtime.js';
import type { PatchStream } from './harness/turn.js';
import { decide } from './harness/nodes.js';
import { policy } from './harness/nodes/policy.js';
import { style } from './harness/nodes/style.js';
import { applyJevDeviation, project } from './harness/nodes/project.js';
import { contentGeneratorFrom } from './harness/clients/content-gen.js';
import { BATCH_FACTORS, DEVIATION_FACTORS } from './harness/clients/jev-questions.js';
import type { Ctx, JevAnswer, JevState } from './harness/types.js';
import { isProjectedSurface, type SurfaceKind } from './compose/projected.js';
import { OPEN_ENDED_CANDIDATES, OPEN_ENDED_INITIAL_STATE } from './compose/candidates.js';
import { jevEvaluator, jevStructureComposer, type StructureComposer } from './contract/compose.js';
import { contentUpdateFrom, deriveContentRequest, validateContentResult } from './contract/content.js';
import { applyAction, describeTask, type ActionInput, type Session } from './session.js';
import { currentYield, findDeviations, setYield, type TaskState } from './domain/recipe.js';
import { JevHttpClient } from './harness/clients/jev.js';

/**
 * The concrete graph.
 *
 *   START ──utterance──► decide ─► policy ─► style ─► structure ─► content ─► END
 *         └──action─────────────────────────────────┘
 *
 * Every arrow above is also a conditional edge to `END`. That is not
 * decoration: **`runGuarded` returning `{ok: false}` does NOT stop the graph**
 * (`graph-runtime.ts`). It converts a failure into a value so no exception
 * reaches the LangGraph stream controller — which would discard every patch
 * already enqueued (p19c) — and the consequence is that the node AFTER a
 * failed one runs anyway, on state the failed node never produced. A `decide`
 * that times out would otherwise let `policy`, `style`, `structure` and
 * `content` each file their own fault, and the turn log would hold five faults
 * describing one failure. `halted` plus a conditional edge after every node
 * that can fail is the only thing that stops it, and nothing upstream can make
 * it automatic. `test/harness/doubles.ts`'s `twoNodeGraph` is the
 * in-tree reproduction of the behaviour without the routing.
 *
 * **Actions bypass `decide` entirely.** A physical control must respond within
 * one frame and never on a model call (CLAUDE.md, "Generated controls"), so a
 * press enters at `act`, which is a pure table over the typed domain model.
 * It is the same graph, the same turn runner and the same sink, so a press
 * barges in on an utterance exactly as an utterance does.
 *
 * Nothing here is per-beat. The only inputs are the session's typed state and
 * Jev's typed answers; a surface nobody scripted composes the same way
 * (constraint 6).
 */

const keep = <T,>(fallback: T) => ({ reducer: (_a: T, b: T): T => b, default: (): T => fallback });

export type TurnInput = { utterance: string } | ActionInput;

/**
 * The graph's entry state is a single `input` channel, so the utterance has
 * to arrive as `{ input: ... }`. `buildGraph` wraps it (see the return value)
 * rather than making the transport know that: `ws-server.ts` hands
 * `startTurn` a `{ utterance }` or an `{ action }` and stays payload-agnostic.
 *
 * A mismatch here would be SILENT — LangGraph falls back to the channel's
 * default — so the default is `null` and `decide` refuses it by name instead
 * of classifying an empty string and painting something plausible.
 */
const wrapInput = (input: unknown): { input: TurnInput | null } => ({
  input: input && typeof input === 'object' && ('utterance' in input || 'action' in input) ? (input as TurnInput) : null,
});

const isAction = (input: TurnInput): input is ActionInput => 'action' in input;

const GraphState = Annotation.Root({
  input: Annotation<TurnInput | null>(keep<TurnInput | null>(null)),
  jev: Annotation<JevAnswer | null>(keep<JevAnswer | null>(null)),
  /** The surface this turn paints. `null` means nothing is renderable. */
  surface: Annotation<SurfaceKind | null>(keep<SurfaceKind | null>(null)),
  /** The task state this turn renders, after any correction Jev reported. */
  task: Annotation<TaskState | null>(keep<TaskState | null>(null)),
  /** What the utterance asked for, in words — the composer's and the content generator's prompt. */
  intent: Annotation<string>(keep('')),
  /**
   * Carried from the `structure` node to the `content` node on the projected
   * path, where the composer produces both.
   *
   * Prefixed because LangGraph refuses a state channel whose name is also a
   * node name — `.addNode('structure', ...)` throws "structure is already
   * being used as a state attribute". It is a construction-time throw, so it
   * cannot reach a running turn, but it does take the process down at boot.
   */
  pendingContent: Annotation<ContentUpdateV2 | null>(keep<ContentUpdateV2 | null>(null)),
  pendingStructure: Annotation<StructureUpdateV2 | null>(keep<StructureUpdateV2 | null>(null)),
  halted: Annotation<boolean>(keep(false)),
});

type GraphStateT = typeof GraphState.State;

export type GraphDeps = {
  session: Session;
  /**
   * Composer for the two open-ended surfaces. Injected so a test can drive the
   * whole graph offline; production passes the Jev-backed one.
   * Absent means composed surfaces are unavailable and say so.
   */
  composer?: StructureComposer | null;
  locale?: string;
  maxWidth?: number;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Binds this stream's writer and records that the node was ENTERED.
 *
 * The entry line is what makes the halt routing observable. Every node also
 * guards its own preconditions (`if (!state.jev) return { halted: true }`),
 * and those guards are what a reader sees first — but they are NOT the
 * mechanism, and a test that only counts faults cannot tell the two apart: a
 * graph with the conditional edges deleted still files one fault, because the
 * guards return before `runGuarded`. It just runs four nodes to do it, on a
 * turn that was over. `node-enter` is the difference, in the log and in the
 * test.
 */
function enter(config: LangGraphRunnableConfig, node: string): TurnRuntime {
  const turn = runtimeOf(config);
  turn.note('node-enter', { node });
  return turn;
}

/** One id per turn, shared by the structure and content updates that pair up. */
const idsFor = (turn: TurnRuntime): { requestId: string; generationId: string } => ({
  requestId: turn.turnId,
  generationId: turn.turnId,
});

/**
 * Does the utterance, as Jev classified it, put the bowl off plan?
 *
 * Not `findDeviations(session.task)` on its own: at the moment the user says
 * "I added twice as much sugar" the session still believes the bowl matches
 * the plan — the deviation is exactly the thing being reported. Answering from
 * the un-corrected state sends a `correct` turn to `correct_keep`, and the
 * recovery beat never appears. So the correction is applied first and the
 * question asked of the result.
 */
function correctedTask(task: TaskState | null, jev: JevAnswer | null, warnings: string[]): TaskState | null {
  if (!task) return null;
  const ingredientId = jev?.deviationIngredient?.value;
  const factor = jev?.deviationFactor?.value;
  if (jev?.route.value !== 'correct' || !ingredientId || !factor) return task;
  if (DEVIATION_FACTORS[factor] === undefined || DEVIATION_FACTORS[factor] === null) return task;
  return applyJevDeviation(task, { ingredientId, factor }, warnings);
}

/**
 * "Actually make it three times the batch."
 *
 * A deliberate change to the plan is a `refine`, and the amount comes back as
 * a BUCKET (`batchFactor`); `setYield` turns it into every number on screen
 * (constraint 2 — the model classifies, code computes).
 *
 * **Refused once anything is in the bowl.** `setYield` moves `scale`, and the
 * bowl does not move with it: rescaling mid-bake would make every ingredient
 * already added read as a deviation and hand the user a recovery beat they
 * did not cause. That is the same asymmetry `planScaleUp` is built around —
 * you cannot un-add flour — so the honest answer is to say so, not to produce
 * a recipe nobody can follow.
 */
function rescaled(task: TaskState | null, jev: JevAnswer, notes: string[]): TaskState | null {
  if (!task || jev.route.value !== 'refine') return task;
  const bucket = jev.batchFactor?.value;
  const factor = bucket === undefined ? undefined : BATCH_FACTORS[bucket];
  if (factor === undefined || factor === null || factor === 1) return task;
  if (Object.keys(task.inBowl).length > 0) {
    notes.push(`refine: cannot rescale to ${bucket} — ${Object.keys(task.inBowl).length} ingredient(s) are already in the bowl`);
    return task;
  }
  const target = Math.round(currentYield(task) * factor);
  notes.push(`refine: ${bucket} — ${currentYield(task)} -> ${target} ${task.recipe.yieldUnit}`);
  return setYield(task, target);
}

/* ------------------------------------------------------------------ *
 * The graph
 * ------------------------------------------------------------------ */

export function buildGraph(deps: GraphDeps): PatchStream {
  const { session } = deps;
  const locale = deps.locale ?? 'en-CA';

  /**
   * `decide` — one batched Jev call: route, templateId, the five style axes,
   * the two style/save gates and the two deviation questions.
   *
   * `taskState` and `currentTemplate` are read from the live session HERE, not
   * captured when the graph was compiled: p18 measured that route is
   * unanswerable from the utterance alone, and a stale summary is worse than
   * none because it is wrong with confidence.
   */
  const decideNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'decide');
    const input = state.input;
    if (!input) {
      // Never classify a default. An input that did not reach the state
      // channel is a wiring bug, and a turn that quietly routed an empty
      // utterance would look like a working demo (constraint 5).
      turn.note('input-missing', { detail: 'the turn was started without { input: ... } — see turnInput()' });
      return { halted: true };
    }
    if (isAction(input)) return {};
    const jevState: JevState = {
      utterance: input.utterance,
      // `grocery_added` is not a `TemplateId`, and the question's option list
      // is the tuned eight. Report the recipe surface it sits on top of rather
      // than a name Jev has never been shown.
      currentTemplate: session.surface === 'grocery_added' ? 'item_detail' : (session.surface as TemplateId | null),
      taskState: describeTask(session),
    };
    const result = await runGuarded(decide, jevState, turn, 'decide-degraded');
    if (!result.ok) {
      // The named degraded state: the route is unknown, so the current surface
      // stays and nothing new is painted. Constraint 5 — the reason is in the
      // log, not hidden behind a substitute surface.
      turn.note('decide-degraded', { aborted: result.aborted });
      return { halted: true };
    }
    const jev = result.out.jev;
    turn.note('jev', {
      route: jev.route.value,
      routeConfidence: round2(jev.route.confidence),
      routeDistribution: jev.route.distribution,
      templateId: jev.templateId.value,
      templateConfidence: round2(jev.templateId.confidence),
      wantsStyleChange: jev.wantsStyleChange?.value ?? null,
      wantsSaved: jev.wantsSaved?.value ?? null,
      deviationIngredient: jev.deviationIngredient?.value ?? null,
      deviationFactor: jev.deviationFactor?.value ?? null,
      deviationFactorConfidence: jev.deviationFactor ? round2(jev.deviationFactor.confidence) : null,
      batchFactor: jev.batchFactor?.value ?? null,
      batchFactorConfidence: jev.batchFactor ? round2(jev.batchFactor.confidence) : null,
      inputTokens: jev.usage.inputTokens,
    });
    return { jev, intent: input.utterance };
  };

  /**
   * `act` — a press, toggle or slider scrub. Pure, no model, no network.
   *
   * A failed action halts rather than painting: an action nothing maps to, or
   * one that needs a task when there is none, must leave the surface it has
   * (CLAUDE.md: below the confidence threshold the device asks rather than
   * guesses, and here there is not even a guess to make).
   */
  const actNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'act');
    const input = state.input;
    if (!input || !isAction(input)) {
      turn.note('input-missing', { detail: 'act reached without an action input' });
      return { halted: true };
    }
    const node = {
      name: 'act',
      async run(): Promise<ReturnType<typeof applyAction>> {
        return applyAction(session, input);
      },
    };
    const result = await runGuarded(node, undefined, turn, 'node-crashed');
    if (!result.ok) return { halted: true };
    if (!result.out.ok) {
      turn.note('action-refused', { action: input.action, reason: result.out.reason });
      return { halted: true };
    }
    turn.note('action', { action: input.action, surface: result.out.surface, detail: result.out.note });
    return {
      surface: result.out.surface,
      task: session.task,
      intent: `The user pressed "${input.action}".`,
    };
  };

  /**
   * `policy` — whether this turn recomposes structure or keeps what is on
   * screen. Deterministic; confidence is deliberately never consulted (p13/p18
   * measured it does not separate right answers from wrong ones).
   */
  const policyNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'policy');
    const jev = state.jev;
    if (!jev) return { halted: true };

    const warnings: string[] = [];
    const corrected = correctedTask(session.task, jev, warnings);
    const hasDeviation = corrected !== null && findDeviations(corrected).length > 0;
    const next = rescaled(corrected, jev, warnings);

    const result = await runGuarded(
      policy,
      {
        route: jev.route.value,
        jevTemplateId: jev.templateId.value,
        currentTemplate: session.surface === 'grocery_added' ? 'item_detail' : (session.surface as TemplateId | null),
        hasDeviation,
      },
      turn,
      'node-crashed',
    );
    if (!result.ok) return { halted: true };

    // The save/track gate. A server-side surface the `templateId` question
    // cannot name, reached by its own typed answer — not by matching a word in
    // the utterance, which would be a hardcoded flow.
    const saved = jev.wantsSaved?.value === true && session.task !== null;
    const surface: SurfaceKind = saved ? 'grocery_added' : result.out.templateId;

    turn.note('policy', { rule: result.out.rule, templateId: result.out.templateId, surface, hasDeviation, ...(warnings.length ? { warnings } : {}) });
    return { surface, task: next };
  };

  /**
   * `style` — enums only, and only when the gate says the utterance asked for
   * a different look. p14 measured that Jev picks a theme on every utterance,
   * restyling surfaces nobody asked to restyle.
   */
  const styleNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'style');
    if (!state.jev) return { halted: true };
    const result = await runGuarded(style, state.jev, turn, 'node-crashed');
    if (!result.ok) return { halted: true };
    const patch: StylePatch | null = result.out;
    if (patch) {
      turn.ctx.sink.emit({ ...patch, stage: 'style' });
      turn.note('style-emitted', { theme: patch.theme });
    }
    return {};
  };

  /**
   * `structure` — picks a composer and emits `StructureUpdateV2`.
   *
   * Projected (deterministic, no model, sub-millisecond) for every surface the
   * typed domain model determines. `composeBatch` asks a per-candidate
   * membership question, so Jev may legitimately omit any single candidate —
   * including the eggs of a recipe — and a domain-required element must not be
   * omittable by a model (ADR 0001). The Jev composer is reserved for the two
   * surfaces whose content is genuinely open.
   *
   * The session is committed here, immediately before the emit, so a turn that
   * halted earlier leaves the task exactly as it was.
   */
  const structureNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'structure');
    const surface = state.surface;
    if (!surface) return { halted: true };
    const ids = idsFor(turn);

    if (isProjectedSurface(surface)) {
      const task = state.task ?? session.task;
      if (!task && surface !== 'choice_cards' && surface !== 'people_picker') {
        turn.note('structure-unavailable', { surface, reason: 'no task is open to project from' });
        return { halted: true };
      }
      const result = await runGuarded(
        project,
        {
          // `choice_cards`/`people_picker` project from seed data, not from a
          // task; `project` ignores `state` for those two.
          state: (task ?? ({} as TaskState)),
          templateId: surface,
          ...ids,
          ...(deps.maxWidth !== undefined ? { maxWidth: deps.maxWidth } : {}),
        },
        turn,
        'node-crashed',
      );
      if (!result.ok) return { halted: true };
      const { structure, content, warnings } = result.out;
      if (warnings.length > 0) turn.note('project-warnings', { warnings });
      if (!structure || !content) {
        turn.note('structure-unavailable', { surface, reason: warnings.join('; ') || 'no surface produced' });
        return { halted: true };
      }
      // Committed only now — a turn that never got here changed nothing.
      session.surface = surface;
      if (task) session.task = task;
      turn.ctx.sink.emit(structure);
      turn.note('structure-emitted', { surface, composer: 'projected', elements: Object.keys(structure.spec.elements).length });
      return { pendingStructure: structure, pendingContent: content };
    }

    // Open-ended: the composer is the point, and a missing one is reported
    // rather than silently replaced by a projected surface that would answer a
    // different question.
    if (!deps.composer) {
      turn.note('structure-unavailable', { surface, reason: 'no composer is wired for open-ended surfaces' });
      return { halted: true };
    }
    const node = {
      name: 'compose',
      async run(_input: void, ctx: Ctx): Promise<StructureUpdateV2 | { unavailable: string }> {
        let last: StructureUpdateV2 | null = null;
        for await (const event of deps.composer!.compose({ intent: state.intent, ...ids }, ctx.signal)) {
          if (event.kind === 'unavailable') return { unavailable: event.reason };
          // ADR 0001: do NOT apply `partial` — its children land flat under
          // root and `complete` reparents them, a visible reorder, and a
          // second structure update resets `/content` and wipes anything that
          // landed between the two. Telemetry only; one paint, at `complete`.
          if (event.update.status !== 'complete') {
            ctx.telemetry({ kind: 'node', node: 'compose-partial', ms: 0 });
            continue;
          }
          last = event.update;
        }
        return last ?? { unavailable: 'the composer produced no complete structure' };
      },
    };
    const result = await runGuarded(node, undefined, turn, 'node-crashed');
    if (!result.ok) return { halted: true };
    if ('unavailable' in result.out) {
      turn.note('structure-unavailable', { surface, reason: result.out.unavailable });
      return { halted: true };
    }
    session.surface = surface;
    turn.ctx.sink.emit(result.out);
    turn.note('structure-emitted', { surface, composer: 'jev', elements: Object.keys(result.out.spec.elements).length });
    return { pendingStructure: result.out };
  };

  /**
   * `content` — fills the surface.
   *
   * A projected surface already has its content: `composeProjected` returns
   * structure and values together, computed from the typed model, so there is
   * nothing to ask anybody. An open-ended one goes
   * `deriveContentRequest` -> the content source -> `validateContentResult` ->
   * `ContentUpdateV2`.
   *
   * On any failure the update is STILL emitted, with every target rejected: a
   * field-less entry clears that element's `pending`, so the surface resolves
   * to its placeholders instead of shimmering for ever (ADR 0001's added
   * invariant). Nothing is invented to fill it.
   */
  const contentNode = async (state: GraphStateT, config: LangGraphRunnableConfig): Promise<Partial<GraphStateT>> => {
    const turn = enter(config, 'content');
    if (state.pendingContent) {
      turn.ctx.sink.emit(state.pendingContent);
      turn.note('content-emitted', { source: 'projected', elements: Object.keys(state.pendingContent.values).length });
      return {};
    }
    const structure = state.pendingStructure;
    if (!structure) return { halted: true };

    const node = {
      name: 'content',
      async run(_input: void, ctx: Ctx): Promise<ContentUpdateV2> {
        const { request, unresolved } = deriveContentRequest({
          requestId: structure.requestId,
          locale,
          intent: state.intent,
          context: { surface: String(state.surface) },
          spec: structure.spec,
        });
        if (unresolved.length > 0) {
          ctx.telemetry({ kind: 'generate-fault', node: 'content', ms: 0, error: new Error(unresolved.map((u) => u.reason).join(' ')) });
        }
        if (request.targets.length === 0) {
          return contentUpdateFrom(request, { result: { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values: {} }, rejected: [] }, { generationId: structure.generationId });
        }
        try {
          const raw = await contentGeneratorFrom(ctx.content).generate(request, ctx.signal);
          const validation = validateContentResult(request, raw);
          if (validation.rejected.length > 0) {
            ctx.telemetry({ kind: 'generate-fault', node: 'content', ms: 0, error: new Error(validation.rejected.map((r) => r.reason).join(' ')) });
          }
          return contentUpdateFrom(request, validation, { generationId: structure.generationId });
        } catch (err) {
          ctx.signal.throwIfAborted();
          // Every target rejected: the shimmer resolves, the reason is logged,
          // and nothing is substituted for the copy that did not arrive.
          ctx.telemetry({ kind: 'generate-fault', node: 'content', ms: 0, error: err });
          const rejected = request.targets.map((t) => ({ elementId: t.elementId, reason: `content generation failed: ${String(err)}` }));
          return contentUpdateFrom(request, { result: { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values: {} }, rejected }, { generationId: structure.generationId });
        }
      },
    };
    const result = await runGuarded(node, undefined, turn, 'node-crashed');
    if (!result.ok) return { halted: true };
    turn.ctx.sink.emit(result.out);
    turn.note('content-emitted', { source: 'generated', elements: Object.keys(result.out.values).length });
    return {};
  };

  const stop = (next: string) => (state: GraphStateT): string => (state.halted ? END : next);

  const graph = new StateGraph(GraphState)
    .addNode('decide', decideNode)
    .addNode('act', actNode)
    .addNode('policy', policyNode)
    .addNode('style', styleNode)
    .addNode('structure', structureNode)
    .addNode('content', contentNode)
    // A missing input goes to `decide`, which refuses it by name. Routing it
    // nowhere would end the turn with no record of why.
    .addConditionalEdges(START, (state: GraphStateT) => (state.input && isAction(state.input) ? 'act' : 'decide'), ['act', 'decide'])
    .addConditionalEdges('decide', stop('policy'), ['policy', END])
    .addConditionalEdges('act', stop('structure'), ['structure', END])
    .addConditionalEdges('policy', stop('style'), ['style', END])
    .addConditionalEdges('style', stop('structure'), ['structure', END])
    .addConditionalEdges('structure', stop('content'), ['content', END])
    .addEdge('content', END)
    .compile();

  const compiled = graph as unknown as PatchStream;
  return {
    stream(input, options) {
      return compiled.stream(wrapInput(input) as never, options);
    },
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The production composer for open-ended surfaces, spending through the same
 * `JevHttpClient` as `decide` — one credential, one budget cap, one keep-alive
 * agent, one telemetry path, and no gateway hop (the library's own adapter
 * wants a Vercel AI Gateway key and answers 401 to this project's credential).
 */
export function liveComposer(client: JevHttpClient, maxWidth = 640): StructureComposer {
  return jevStructureComposer({
    evaluate: jevEvaluator(client),
    candidates: OPEN_ENDED_CANDIDATES,
    initialState: OPEN_ENDED_INITIAL_STATE,
    context: { device: '800x480 touch display', catalogVersion: 'jit-device.v2' },
    maxWidth,
  });
}
