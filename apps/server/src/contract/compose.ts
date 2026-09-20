import {
  experimental_composeSpec,
  experimental_createEvaluator,
  type Experimental_ChoiceQuestion,
  type Experimental_CompositionCandidate,
  type Experimental_CompositionEvaluator,
} from '@json-render/core';
import { JIT_CATALOG } from '@jit/renderer';
import { SurfaceSpecSchema, type JsonObject, type JsonValue, type StructureUpdateV2, type SurfaceSpec } from '@jit/schema';
import { HARD_DEADLINE_MS, type JevHttpClient } from '../harness/clients/jev.js';
import { contentPointer } from './content.js';

export type ComposeInput = { intent: string; requestId: string; generationId: string };

/** What the composer spent and why it stopped. `null` until the run ends. */
export type ComposeCompletion = {
  stopReason: 'finish' | 'limit' | 'unavailable';
  inputTokens: number | null;
  elapsedMs: number;
  steps: number;
};

/**
 * `unavailable` is a real outcome, not an absence.
 *
 * Jev answers `unavailable` when the candidate pool cannot fulfil the
 * request; the library then completes with `spec: null`. Skipping that event
 * ends the turn painting nothing and reporting nothing, which is the silent
 * failure CLAUDE.md constraint 5 forbids. The caller gets a typed event it
 * can act on instead.
 */
export type ComposeEvent =
  | { kind: 'structure'; update: StructureUpdateV2; completion: ComposeCompletion | null }
  | { kind: 'unavailable'; reason: string; completion: ComposeCompletion };

export type StructureComposer = {
  /**
   * `signal` is the turn's barge-in signal. A composition that cannot be
   * cancelled outlives the utterance that asked for it.
   */
  compose: (input: ComposeInput, signal: AbortSignal) => AsyncIterable<ComposeEvent>;
};

/** Offline/test adapter; production replaces it with the Jev adapter at the same seam. */
export function fixtureComposer(structure: StructureUpdateV2): StructureComposer {
  return {
    async *compose(_input, signal) {
      signal.throwIfAborted();
      yield { kind: 'structure', update: structure, completion: { stopReason: 'finish', inputTokens: 0, elapsedMs: 0, steps: 0 } };
    },
  };
}

export type JevCandidate = Omit<Experimental_CompositionCandidate, 'element'> & {
  element: SurfaceSpec['elements'][string];
};

/**
 * Exactly two serialised evaluator round trips happen per composition
 * (`select`, then `layout` — the batch path), and each is already bounded by
 * the client's own per-call hard deadline. This bounds the whole composition,
 * so a stalled second call cannot hold the turn open past the first one's
 * budget twice over.
 */
export const COMPOSE_DEADLINE_MS = 2 * HARD_DEADLINE_MS;

/**
 * Rewrites a composed spec's content bindings onto the element keys the
 * library assigned.
 *
 * `composeBatch` keys elements `node_0…node_N` and `structuredClone`s each
 * candidate's element verbatim, so a candidate written as
 * `{$state: '/content/title/text'}` keeps pointing at `/content/title/text`
 * while the device — which writes `values[elementId][field]` — writes
 * `/content/node_2/text`. The content then never lands and the element
 * shimmers for ever. This makes the element key the single identity: the
 * state path's element segment, the `id` prop and the `state.content` key all
 * become it.
 *
 * Content values are COPIED, not moved, so two candidates that happen to name
 * the same source segment each get their own; segments nothing points at are
 * dropped.
 */
export function rebindComposedSpec(spec: SurfaceSpec): SurfaceSpec {
  const next = structuredClone(spec);
  const source = (next.state?.content ?? {}) as Record<string, JsonValue>;
  const content: Record<string, JsonObject> = {};
  for (const [elementId, element] of Object.entries(next.elements)) {
    const rebind = (value: JsonValue): JsonValue => {
      const pointer = contentPointer(value);
      if (pointer) {
        const from = source[pointer.elementId];
        const bucket = (content[elementId] ??= {});
        if (from && typeof from === 'object' && !Array.isArray(from) && pointer.field in from) bucket[pointer.field] = from[pointer.field]!;
        const key = '$state' in (value as object) ? '$state' : '$bindState';
        return { [key]: `/content/${elementId}/${pointer.field}` };
      }
      if (Array.isArray(value)) return value.map(rebind);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rebind(child)]));
      return value;
    };
    element.props = rebind(element.props as JsonValue) as SurfaceSpec['elements'][string]['props'];
    if (element.visible !== undefined && typeof element.visible !== 'boolean') element.visible = rebind(element.visible as JsonValue) as typeof element.visible;
    for (const binding of Object.values(element.on ?? {})) {
      if (binding.params) binding.params = rebind(binding.params as JsonValue) as typeof binding.params;
    }
    // One identity per element: `id` is what the renderer writes as
    // `data-slot`, and a candidate placed under a new key must not keep the
    // candidate's own name.
    if (typeof element.props.id === 'string') element.props.id = elementId;
  }
  if (next.state?.content !== undefined || Object.keys(content).length > 0) next.state = { ...next.state, content };
  return next;
}

/**
 * Drives composition through OUR Jev client: one credential, one budget cap,
 * one keep-alive agent, one telemetry path, and no gateway hop.
 *
 * `experimental_composeSpec` only ever asks `choice` questions and reads
 * `answers[name].choice`/`.confidence` — the exact shape `JevHttpClient`
 * already speaks — so the seam needs a translation, not a transport.
 */
export function jevEvaluator(client: JevHttpClient): Experimental_CompositionEvaluator {
  return async ({ state, questions, signal }) => {
    const raw = await client.evaluateQuestions(state, questions, signal);
    const answers = Object.fromEntries(Object.entries(questions).map(([name]) => {
      const answer = raw.answers[name];
      if (!answer || answer.type !== 'choice') throw new Error(`Jev returned no choice for composition question "${name}".`);
      return [name, { choice: answer.choice, ...(typeof answer.confidence === 'number' ? { confidence: answer.confidence } : {}) }];
    }));
    const inputTokens = raw.usage?.input_tokens;
    return { answers, ...(typeof inputTokens === 'number' ? { usage: { inputTokens } } : {}) };
  };
}

/**
 * The library's own adapter, which posts to Vercel's AI Gateway and needs a
 * gateway key. Kept as a seam, not a default: the project's TypeSafe key is
 * rejected there with HTTP 401, so the gateway path is unusable with the
 * credential this repo has.
 */
export function gatewayEvaluator(options: { apiKey: string; model?: string; timeoutMs?: number }): Experimental_CompositionEvaluator {
  return experimental_createEvaluator({ apiKey: options.apiKey, model: options.model ?? 'typesafe-ai/jev', timeoutMs: options.timeoutMs ?? HARD_DEADLINE_MS });
}

/** Server-side adapter for the pinned experimental Jev composer. Credentials never reach the renderer. */
export function jevStructureComposer(options: {
  evaluate: Experimental_CompositionEvaluator;
  candidates: readonly JevCandidate[];
  initialState: Record<string, unknown>;
  context?: Record<string, unknown>;
  maxWidth?: number;
  maxElements?: number;
  maxDepth?: number;
  /** Bounds the whole composition. Defaults to `COMPOSE_DEADLINE_MS`. */
  timeoutMs?: number;
}): StructureComposer {
  for (const candidate of options.candidates) {
    // Rebinding makes `$state` and `id` per-instance, but an action name
    // cannot be: it is a catalog name the hardware layer maps a button to, so
    // two instances of one candidate would give two elements the same action
    // and `getActions()` could not tell them apart. One candidate per
    // instance keeps every action unambiguous.
    if ((candidate.maxUses ?? 1) > 1) throw new Error(`Candidate ${candidate.id} sets maxUses > 1; declare one candidate per instance instead.`);
  }
  return {
    async *compose(input, signal) {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? COMPOSE_DEADLINE_MS)]);
      for await (const event of experimental_composeSpec({
        catalog: JIT_CATALOG,
        candidates: options.candidates as readonly Experimental_CompositionCandidate[],
        prompt: input.intent,
        initialState: options.initialState,
        ...(options.context ? { context: options.context } : {}),
        evaluate: options.evaluate,
        ...(options.maxElements ? { maxElements: options.maxElements } : {}),
        ...(options.maxDepth ? { maxDepth: options.maxDepth } : {}),
        signal: deadline,
      })) {
        const completion: ComposeCompletion | null = event.type === 'complete'
          ? { stopReason: event.stopReason, inputTokens: event.inputTokens, elapsedMs: event.elapsedMs, steps: event.steps.length }
          : null;
        if (!event.spec) {
          yield {
            kind: 'unavailable',
            reason: 'Jev answered "unavailable": the candidate pool cannot fulfil this request.',
            completion: completion ?? { stopReason: 'unavailable', inputTokens: null, elapsedMs: 0, steps: 0 },
          };
          return;
        }
        yield {
          kind: 'structure',
          // `complete` is terminal whatever the stop reason: `limit` means
          // the tree was truncated, not that more is coming. Reporting it as
          // `partial` leaves the surface waiting for an update that the
          // generator has already finished producing.
          update: {
            v: 2,
            stage: 'structure',
            requestId: input.requestId,
            generationId: input.generationId,
            maxWidth: options.maxWidth ?? 640,
            status: event.type === 'complete' ? 'complete' : 'partial',
            spec: SurfaceSpecSchema.parse(rebindComposedSpec(event.spec as SurfaceSpec)),
          },
          completion,
        };
      }
    },
  };
}

export type { Experimental_ChoiceQuestion as ComposeQuestion };
