import { randomUUID } from 'node:crypto';
import type { SurfaceUpdate } from '@jit/schema';
import { createRealPatchSinkStore, type DropReason, type GatedSink } from './clients/sink.js';
import type { TurnRuntime } from './graph-runtime.js';
import { createTurnLog, describeError, DEFAULT_TURN_LOG_PATH, type TurnLog } from './turn-log.js';
import type { ContentModel, ContentSource, Ctx, Event, JevClient } from './types.js';

/**
 * One utterance, start to finish: an `AbortController`, a turn-gated
 * **synchronous** sink bridged onto LangGraph's `config.writer`, a buffered
 * JSONL line flushed in a `finally`, and an async iterable of patches.
 *
 * **Adapter-shaped on purpose.** `Turn.patches` yields a payload and nothing
 * else — no LangGraph types, no envelope. A websocket server is a `for await`
 * over this that calls `ws.send(JSON.stringify(patch))`; it is not a rewrite
 * of anything here. Telemetry deliberately does NOT ride this iterator
 * (`streamMode: ["custom","updates"]` would put LangGraph node-update objects
 * in a stream whose consumer is a device); it goes to the buffered turn log,
 * which is what a `grep <turnId>` reconstructs.
 *
 * **Payload-agnostic.** Nothing here inspects an update. `SurfaceUpdate` is
 * a type parameter in all but name: it is never read, never discriminated,
 * never normalised — in particular `stage` is left exactly as the producer
 * set it, because `StyleUpdateV1`/`PolishUpdateV1` make it optional and the
 * renderer discriminates those on `'theme' in` / `'tokens' in` instead.
 * Shape checking is the injected `validate` hook, so the validator belongs
 * to whoever owns the contract, not to the transport.
 */

/**
 * What `startTurn` needs of a graph: something that streams `[mode, payload]`
 * tuples given the turn's configurable. Structural rather than a concrete
 * compiled-graph type, because the node set it wires is being retargeted and
 * because proving the reliability properties needs a node that fails in a
 * way no production node does.
 */
export type PatchStream = {
  stream(input: never, options: TurnStreamOptions): Promise<AsyncIterable<unknown>>;
};

export type TurnStreamOptions = {
  streamMode: ['custom'];
  configurable: { turn: TurnRuntime };
  recursionLimit: number;
};

export type TurnDeps = {
  /** The compiled graph. See `PatchStream`. */
  graph: PatchStream;
  jev: JevClient;
  content: ContentSource;
  contentModel: ContentModel;
  /** `null` keeps the turn log in memory only — what unit tests want. */
  logPath?: string | null;
  now?: () => number;
  /** Extra telemetry consumer. The turn log always gets everything regardless. */
  telemetry?: (event: Event) => void;
  /**
   * Boundary shape check. Returns a one-line reason, or `null` when the
   * patch is well formed. A rejected patch is dropped and logged — never
   * repaired, never substituted for (constraint 5).
   *
   * Injected rather than imported: the validator is owned by whoever owns
   * the render contract, and it MUST NOT throw — an exception here would
   * reach the stream controller and discard every chunk already enqueued.
   */
  validate?: (patch: SurfaceUpdate) => string | null;
};

export type Turn = {
  turnId: string;
  /** Yields each patch as it is produced. Iterate once. */
  patches: AsyncGenerator<SurfaceUpdate>;
  /**
   * Barge-in. Aborts the turn's signal (stops the spend) AND closes its sink
   * (stops the paint). Both halves are needed: p19b measured that a node
   * which never threads `ctx.signal` into its own await runs to completion
   * regardless of what the consumer does, so the signal alone cannot promise
   * "zero patches after abort".
   */
  abort(reason?: unknown): void;
  /** The turn's log buffer, readable after the iterator has finished. */
  readonly log: TurnLog;
  /** ms from turn start to the first patch reaching the sink. */
  readonly firstEmitMs: number | null;
  /** ms from turn start to the first patch reaching the consumer. */
  readonly firstPatchMs: number | null;
};

export function startTurn(input: unknown, deps: TurnDeps): Turn {
  const now = deps.now ?? ((): number => performance.now());
  const t0 = now();
  const turnId = randomUUID();
  const logPath = deps.logPath === undefined ? DEFAULT_TURN_LOG_PATH : deps.logPath;
  const log = createTurnLog(turnId, logPath, now);
  const controller = new AbortController();

  let firstEmitMs: number | null = null;
  let firstPatchMs: number | null = null;
  let writer: ((chunk: unknown) => void) | undefined;

  const onDrop = (_turnId: string, patch: SurfaceUpdate, reason: DropReason): void => {
    // Never silent. A node still emitting after its turn ended is a real
    // bug; we keep it off the device and put it in the log (constraint 5).
    log.record('patch-dropped', { reason, patch });
  };

  /**
   * The bridge. Synchronous end to end — validate, log, write. No `await`
   * anywhere on this path: p19c measured that consumer-side lag is what
   * loses queued chunks when something later errors, and an `await` here IS
   * consumer-side lag.
   */
  const deliver = (patch: SurfaceUpdate): void => {
    const problem = deps.validate?.(patch) ?? null;
    if (problem) {
      log.record('patch-rejected', { reason: problem, patch });
      return;
    }
    firstEmitMs ??= now() - t0;
    log.record('patch', { patch });
    if (!writer) throw new Error('turn: config.writer was never bound — a patch would be a silent no-op');
    writer(patch);
  };

  const store = createRealPatchSinkStore(deliver, onDrop);
  const sink: GatedSink = store.beginTurn(turnId, controller.signal);

  const telemetry = (event: Event): void => {
    log.record(event.kind, {
      node: event.node,
      ms: Math.round(event.ms),
      ...('reason' in event ? { reason: event.reason } : {}),
      ...(event.error !== undefined ? { error: describeError(event.error) } : {}),
    });
    deps.telemetry?.(event);
  };

  const ctx: Ctx = { jev: deps.jev, content: deps.content, contentModel: deps.contentModel, sink, signal: controller.signal, now, telemetry };

  const runtime: TurnRuntime = {
    turnId,
    ctx,
    note: (kind, data) => log.record(kind, data),
    bindWriter: (w) => {
      if (!w) throw new Error('turn: LangGraph gave the node no config.writer — patches would be silently dropped');
      writer = w;
    },
  };

  let aborted = false;
  const abort = (reason?: unknown): void => {
    if (aborted) return;
    aborted = true;
    const err = reason ?? new Error('barge-in');
    log.record('abort', { reason: describeError(err) });
    // Sink first, signal second. Closing the sink is unconditional and
    // instant; the signal only stops nodes that cooperate with it.
    sink.close();
    controller.abort(err);
  };

  async function* run(): AsyncGenerator<SurfaceUpdate> {
    log.record('turn-start', { input });
    let outcome = 'ok';
    let completed = false;
    try {
      const stream = await deps.graph.stream(input as never, {
        // The ARRAY form, always. `streamMode: "custom"` (a bare string)
        // yields bare payloads; `["custom"]` — even with one entry — yields
        // `[mode, payload]` tuples. Measured on @langchain/langgraph 1.4.16
        // and asserted in graph-stream.test.ts, because it is a silent shape
        // change if a version bump flips it.
        streamMode: ['custom'],
        // Deliberately NO `signal` here. LangGraph's own abort path throws at
        // the consumer, which is `controller.error()` on the underlying
        // ReadableStream, which resets its queue and discards every chunk
        // enqueued but not yet read (p19c). Cancellation goes through
        // `ctx.signal` and the closed sink instead — p19b measured that is
        // the only thing that stops a node anyway.
        configurable: { turn: runtime },
        recursionLimit: 25,
      });
      for await (const chunk of stream) {
        const [, payload] = chunk as [string, SurfaceUpdate];
        // The one case the sink's gate structurally cannot catch: a patch
        // emitted microseconds BEFORE the abort passes the gate legitimately,
        // then sits in LangGraph's queue and is read after it. Handing that
        // on is a paint after barge-in.
        //
        // Not the primary defence, and measured as such — the sink's signal
        // gate alone keeps the socket-level barge-in test green with this
        // break disabled, because a node emitting on a 15ms cadence rarely
        // straddles the abort. A node emitting a burst with no awaits
        // between (the p19e shape) straddles it routinely, which is why this
        // stays. Breaking also releases the consumer instead of making it
        // wait out a node that ignores the signal (p19b).
        if (aborted) {
          log.record('patch-dropped', { reason: 'aborted', patch: payload, stage: 'stream-queue' });
          break;
        }
        firstPatchMs ??= now() - t0;
        yield payload;
      }
      completed = true;
    } catch (err) {
      outcome = 'crashed';
      log.record('turn-error', { error: describeError(err) });
      throw err;
    } finally {
      if (aborted) {
        // Checked first: the stream loop `break`s on an abort and therefore
        // also falls through to `completed = true`.
        if (outcome === 'ok') outcome = 'aborted';
      } else if (completed) {
        // The graph ran out of patches on its own. Close the sink so a node
        // still running somehow cannot paint, but do NOT abort: recording
        // an abort on every successful turn would make the log unable to
        // answer the one question it exists for — did this turn abort?
        sink.close();
      } else {
        // The consumer walked away mid-stream (a `break`, or a thrown error
        // in its body). That is a barge-in, and p19b measured that nothing
        // on the consumer side stops a running node — leaving without
        // aborting leaks the whole remaining generation and keeps paying
        // for it.
        abort(new Error('consumer left before the turn ended'));
        if (outcome === 'ok') outcome = 'aborted';
      }
      log.record('turn-end', { firstEmitMs: round(firstEmitMs), firstPatchMs: round(firstPatchMs) });
      log.flush(outcome);
    }
  }

  return {
    turnId,
    patches: run(),
    abort,
    log,
    get firstEmitMs(): number | null {
      return firstEmitMs;
    },
    get firstPatchMs(): number | null {
      return firstPatchMs;
    },
  };
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v));

/**
 * Holds the one active turn. A second utterance aborts the first — barge-in
 * is the normal way to correct yourself on a voice device, not an exception
 * (plan, "Reliability").
 */
export type TurnRunner = {
  say(input: unknown): Turn;
  abort(reason?: unknown): void;
};

export function createTurnRunner(deps: TurnDeps): TurnRunner {
  let active: Turn | null = null;
  return {
    say(input: unknown): Turn {
      active?.abort(new Error('barge-in: a new utterance started'));
      active = startTurn(input, deps);
      return active;
    },
    abort(reason?: unknown): void {
      active?.abort(reason);
    },
  };
}
