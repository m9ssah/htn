import type { Density, FontPairing, Motif, Palette, Patch, Radius, TemplateId } from '@jit/schema';

/**
 * The seam every orchestration node runs behind. Deliberately small: a node is
 * a name plus a pure async function of (input, ctx). LangGraph (P4) wires these
 * into a graph; nothing here knows LangGraph exists.
 */
export type Node<In, Out> = {
  name: string;
  run(input: In, ctx: Ctx): Promise<Out>;
};

export type Ctx = {
  jev: JevClient;
  content: ContentSource;
  sink: PatchSink;
  /**
   * Load-bearing, not decorative. `backend/probes/p19b_langgraph_cancel.mjs`
   * measured that breaking a consumer loop, `AbortController.abort()`, and
   * `iterator.return()` all leave an async node running to completion —
   * cancellation is cooperative. Only a node that threads `signal` into its
   * own `await` (see `./signal.ts`) actually stops.
   */
  signal: AbortSignal;
  now: () => number;
  telemetry: (e: Event) => void;
};

/**
 * One line of the timing/observability log. `error` is set only when the node
 * threw or was aborted — see `./timed.ts`, which emits this in a `finally` so
 * a failing node is never silently unmeasured.
 *
 * `turnId` is optional here: P1 has no turn concept outside `PatchSink`
 * (§"Turn gating"). Full threading through every event is P4's job.
 *
 * A discriminated union, widened once so far. The plan already commits to
 * more event kinds later — the full Jev distribution per question, `jev.*`
 * vs `applied.*` plus which policy rule fired, per-slot arrival timestamps —
 * and none of that is P1's job. `kind: 'node'` just means adding those is
 * additive at every `ctx.telemetry` call site instead of a breaking widen.
 *
 * `generate-fault` is the first addition: `generate` (P5) catches its own
 * content-source failures rather than letting them reach the stream
 * controller (see `ContentSource`'s doc), so `timed()`'s throw-path telemetry
 * never fires for that case — this is how `generate` reports the failure
 * instead. Same base fields as `node` (`node`/`ms`/`error`) so existing
 * `events[0]?.ms`-style call sites keep working across the union.
 */
export type Event =
  | {
      kind: 'node';
      node: string;
      ms: number;
      turnId?: string;
      error?: unknown;
    }
  | {
      kind: 'generate-fault';
      node: string;
      ms: number;
      error: unknown;
    }
  | {
      /**
       * P4's addition, and the second use of the widening `node` was written
       * for. The graph wrapper catches every node failure and returns
       * normally (p19d — an exception reaching the stream controller discards
       * every chunk enqueued but not yet read), so `timed()`'s throw-path
       * telemetry fires but nothing else would say the turn degraded. This
       * is that record. Same base fields (`node`/`ms`/`error`) as the other
       * two, so `events[0]?.ms`-style call sites keep working.
       */
      kind: 'fault';
      node: string;
      ms: number;
      error: unknown;
      reason: FaultReason;
    };

/**
 * `decide-degraded` is the plan's named telemetry for "the route is
 * unknown" — the current surface stays, nothing new is painted (done-when
 * 5). `node-crashed` is any other node failing; the surface keeps whatever
 * already landed. `aborted` is a barge-in, which is not a failure.
 */
export type FaultReason = 'decide-degraded' | 'node-crashed' | 'aborted';

/**
 * The 5-way route + `other`, upstream of the template answer
 * (docs/orchestration-plan.md "The shape"). Unanswerable from the utterance
 * alone (p18) — see `JevState` below.
 */
export type Route = 'new_task' | 'refine' | 'correct' | 'select' | 'query' | 'other';

/**
 * `ask`'s real input. p18/p18b/p18c measured that route is unanswerable from
 * the utterance alone — "refine"/"correct"/"select" and "the second one" are
 * only classifiable with something already on screen — so the batched call
 * needs `currentTemplate` and `taskState` alongside the utterance. This
 * replaced P1's single-string placeholder; see the comment that used to live
 * here, preserved in git history.
 */
export type JevState = {
  utterance: string;
  currentTemplate: TemplateId | null;
  taskState: string;
};

/** option -> probability. Never collapse this to the argmax before logging it
 * — p13 found a wrong answer at 0.723 sitting above a correct one at 0.317. */
export type Distribution<T extends string> = Partial<Record<T, number>>;

/**
 * One `choice` question's answer, normalised. `confidence` is not a gate —
 * docs/orchestration-plan.md "Reliability" measured it does not separate
 * right answers from wrong ones — it is carried through for telemetry only.
 */
export type JevChoiceAnswer<T extends string> = {
  value: T;
  confidence: number;
  distribution: Distribution<T>;
};

/**
 * One `noul` (yes/no) question's answer. Jev's `noul` primitive
 * (`backend/jev/client.py`) returns a bare probability, not a labelled
 * choice — `value` is that probability thresholded at 0.5, `probability` is
 * the raw number (the calibration data worth keeping), and `confidence` is
 * derived the same way the Python client derives it: `abs(p - 0.5) * 2`.
 */
export type JevNoulAnswer = {
  value: boolean;
  probability: number;
  confidence: number;
};

/**
 * Constraint 1 (CLAUDE.md): Jev returns typed values only — a flat set of
 * enums, booleans, scores or selections from a finite list, never free-form
 * strings or nested JSON. Every field here is a `choice` (or `noul`) answer
 * plus its full distribution, never a bare argmax — see `Distribution`'s
 * comment. Building this into `SkeletonPatch`/`StylePatch` is `decide`'s job,
 * not the client's; applying (or overriding) `templateId` is `policy`'s (P2),
 * not `decide`'s.
 *
 * `wantsStyleChange`/`deviationIngredient`/`deviationFactor` are optional and
 * added by P2 (`style`'s gate, `project`'s recovery beat) — they are absent
 * from the four recorded fixtures (`fixtures/jev/recorded/*.json`), which
 * predate them, so parsing must not require them.
 */
export type JevAnswer = {
  route: JevChoiceAnswer<Route>;
  templateId: JevChoiceAnswer<TemplateId>;
  theme: {
    palette: JevChoiceAnswer<Palette>;
    fontPairing: JevChoiceAnswer<FontPairing>;
    density: JevChoiceAnswer<Density>;
    radius: JevChoiceAnswer<Radius>;
    motif: JevChoiceAnswer<Motif>;
  };
  /** Does the utterance express a preference about how the interface should
   * LOOK? `style`'s only gate (p14: Jev otherwise picks a theme on every
   * utterance). */
  wantsStyleChange?: JevNoulAnswer;
  /** `correct`-route only: which of the current recipe's ingredients the
   * utterance was about. */
  deviationIngredient?: JevChoiceAnswer<string>;
  /** `correct`-route only: roughly how far off the planned amount. */
  deviationFactor?: JevChoiceAnswer<string>;
  usage: { inputTokens: number; outputTokens: number };
};

export interface JevClient {
  ask(state: JevState, signal: AbortSignal): Promise<JevAnswer>;
}

/** Used by `generate`. Implementations MUST check `signal` between chunks. */
export interface ContentSource {
  stream(prompt: string, signal: AbortSignal): AsyncIterable<string>;
}

/**
 * `emit` returns `void`, so it cannot do I/O. TypeScript will still let a
 * caller write `await sink.emit(p)` — `await` on a `void` is legal — but an
 * awaited `void` costs one microtask, never a filesystem or socket round trip.
 * That is the property that actually matters here:
 *
 * `p19c`/`p19d` measured that a node error reaching a stream controller
 * (`controller.error()`) resets its queue, discarding chunks enqueued but not
 * yet read: 6/6 delivered at 0ms consumer lag, 3/6 at 150ms/chunk, 2/6 at
 * 300ms/chunk. Any file/network I/O a sink needs must therefore be buffered in
 * memory here and flushed once — `flush` exists for exactly that, and is
 * optional because an in-memory sink has nothing to flush.
 *
 * A node only ever sees a `PatchSink` already scoped to its turn — it never
 * handles a `turnId` itself, because `Ctx` has none to give it. `emit` takes
 * just the patch.
 */
export interface PatchSink {
  emit(patch: Patch): void;
  flush?(): void;
}

/**
 * Where the turn id actually lives — not on `Patch` (`packages/schema` is a
 * frozen contract, see CLAUDE.md "Do not touch"), and not smuggled into
 * `Ctx` either. `beginTurn` advances the store on (implementations gate on a
 * monotonic counter, not on `turnId` equality — re-entering the same turn id
 * later must NOT resurrect the sink from its first use; see `sink.ts`) and
 * hands back a `PatchSink` closed over that moment. Once a later
 * `beginTurn` call moves the store on, the earlier sink's `emit` becomes a
 * silent no-op forever, even if a later call reuses its `turnId`. Probe 17
 * measured 5s and 21s tails, so a late patch from a previous utterance can
 * otherwise land in the current surface. P4 calls `beginTurn` once per turn
 * and puts the result on that turn's `Ctx.sink` — never twice for the same
 * turn, which is why this is named as an action, not a lookup.
 */
export interface PatchSinkStore {
  /**
   * `signal` is the turn's `AbortSignal` and closes a hole the epoch alone
   * cannot: the epoch only advances when the NEXT turn begins, and a barge-in
   * precedes that by an unbounded interval (the user may simply stop
   * talking). For that whole window an aborted turn's sink was still live.
   * With the signal bound here, `emit` becomes a no-op the instant the turn
   * is cancelled — for every node at once, including ones that never consult
   * `Ctx.signal` themselves (p19b measured that such nodes keep running).
   *
   * Optional so a test or CLI with no turn to cancel can still open a sink.
   * Dropped patches still reach `onDrop` — silence would convert a visible
   * bug into an invisible one (constraint 5).
   */
  beginTurn(turnId: string, signal?: AbortSignal): PatchSink;
}
