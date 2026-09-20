import type { Patch, TemplateId } from '@jit/schema';

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
 * A discriminated union of one member on purpose. The plan already commits to
 * more event kinds later — the full Jev distribution per question, `jev.*`
 * vs `applied.*` plus which policy rule fired, per-slot arrival timestamps,
 * degraded/crashed markers — and none of that is P1's job. `kind: 'node'`
 * just means adding those is additive at every `ctx.telemetry` call site
 * instead of a breaking widen.
 */
export type Event = {
  kind: 'node';
  node: string;
  ms: number;
  turnId?: string;
  error?: unknown;
};

/**
 * Constraint 1 (CLAUDE.md): Jev returns typed values only — a flat set of
 * enums, booleans, scores or selections from a finite list, never free-form
 * strings or nested JSON. `templateId` and `confidence` are that shape for the
 * `decide` node's route/template judgement.
 */
export type JevAnswer = {
  templateId: TemplateId;
  confidence: number;
};

/**
 * `ask`'s single-string input is a P1 placeholder, not a settled shape.
 * p18/p18b/p18c measured that route is unanswerable from the utterance
 * alone — "refine"/"correct"/"select" and "the second one" are only
 * classifiable with something already on screen — so P3's real batched call
 * will need `currentTemplate` and `taskState` alongside the utterance. That
 * is a breaking change to `ask`'s INPUT, not an additive widen like `Event`'s
 * `kind` discriminator above: there is no way to add required context to an
 * existing single-string parameter without changing every call site. P3
 * should plan for that rather than be surprised by it.
 */
export interface JevClient {
  ask(utterance: string, signal: AbortSignal): Promise<JevAnswer>;
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
  beginTurn(turnId: string): PatchSink;
}
