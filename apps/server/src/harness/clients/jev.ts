import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Density, FontPairing, Motif, Palette, Radius, TemplateId } from '@jit/schema';
import type { JevAnswer, JevChoiceAnswer, JevClient, JevNoulAnswer, JevState, Route } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';
import {
  AXIS_DESCRIPTIONS,
  DEVIATION_FACTOR_DESCRIPTIONS,
  DEVIATION_INGREDIENT_DESCRIPTIONS,
  ROUTE_QUESTION,
  ROUTES,
  TEMPLATE_DESCRIPTIONS,
  buildQuestions,
  buildWireState,
} from './jev-questions.js';
import type { JevChoiceQuestion, JevQuestion } from './jev-questions.js';

const HOST = 'api.typesafe.ai';
const PATH = '/v1/systemone';
const KEY_FILE = join(homedir(), '.config', 'typesafe', 'env');

// TypeSafe bills input tokens only; output is free.
const USD_PER_INPUT_TOKEN = 42 / 1e9;

/**
 * Provisional — n≈7-8 rows per probe, no p99 (docs/orchestration-plan.md
 * "Reliability"). `SOFT_DEADLINE_MS` names the threshold below which a late
 * answer is still worth waiting for; it needs no code of its own because
 * "keep waiting" is what not aborting already does. `HARD_DEADLINE_MS` is
 * enforced below via `AbortSignal.timeout`.
 */
const SOFT_DEADLINE_MS = 500;
export const HARD_DEADLINE_MS = 1500;

function loadKey(): string {
  const fromEnv = process.env.TYPESAFE_API_KEY;
  if (fromEnv) return fromEnv;
  if (existsSync(KEY_FILE)) {
    const match = /TYPESAFE_API_KEY=(\S+)/.exec(readFileSync(KEY_FILE, 'utf8'));
    if (match?.[1]) return match[1];
    throw new Error(`${KEY_FILE} exists but has no TYPESAFE_API_KEY=... line`);
  }
  throw new Error(`No TYPESAFE_API_KEY in env or ${KEY_FILE}`);
}

/** Mirrors `backend/jev/client.py`'s `Budget`. Thrown rather than spending past the cap. */
export class JevBudgetError extends Error {}

export type JevWireChoiceAnswer = {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
};
/** A `noul` answer's wire shape: a bare probability, no confidence field (`backend/jev/client.py`). */
export type JevWireNoulAnswer = {
  type: 'noul';
  noul: number;
};
export type JevWireAnswer = JevWireChoiceAnswer | JevWireNoulAnswer;
export type JevWireResponse = {
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  answers: Record<string, JevWireAnswer>;
};

function parseChoice<T extends string>(raw: JevWireResponse, qid: string, allowed: readonly T[]): JevChoiceAnswer<T> {
  const answer = raw.answers[qid];
  if (!answer) throw new Error(`Jev response missing an answer for "${qid}"`);
  if (answer.type !== 'choice') {
    throw new Error(`Jev response for "${qid}" is not a choice answer (got "${answer.type}")`);
  }
  if (!allowed.includes(answer.choice as T)) {
    throw new Error(`Jev returned an unknown "${qid}" value: "${answer.choice}"`);
  }
  return {
    value: answer.choice as T,
    confidence: answer.confidence,
    distribution: (answer.probabilities ?? {}) as Partial<Record<T, number>>,
  };
}

/**
 * Optional counterpart to `parseChoice` — `wantsStyleChange`,
 * `deviationIngredient` and `deviationFactor` are absent from the four
 * recorded fixtures (predate P2), so a missing answer here is not an error.
 */
function parseChoiceOptional<T extends string>(
  raw: JevWireResponse,
  qid: string,
  allowed: readonly T[],
): JevChoiceAnswer<T> | undefined {
  if (!raw.answers[qid]) return undefined;
  return parseChoice(raw, qid, allowed);
}

/** Same optionality as `parseChoiceOptional`, for the `noul` primitive. */
function parseNoulOptional(raw: JevWireResponse, qid: string): JevNoulAnswer | undefined {
  const answer = raw.answers[qid];
  if (!answer) return undefined;
  if (answer.type !== 'noul') {
    throw new Error(`Jev response for "${qid}" is not a noul answer (got "${answer.type}")`);
  }
  const p = answer.noul;
  if (typeof p !== 'number' || Number.isNaN(p)) {
    throw new Error(`Jev returned a non-numeric "${qid}" noul value: "${String(p)}"`);
  }
  return { value: p >= 0.5, probability: p, confidence: Math.abs(p - 0.5) * 2 };
}

/**
 * Turns the raw wire response into a `JevAnswer`, validating every value
 * against the finite option set it was asked with — model output is runtime
 * data, not something TypeScript already checked (docs/orchestration-plan.md
 * "Validate generated slot values at the boundary" makes the same point about
 * `generate`; this is the same discipline for `decide`).
 *
 * Shared by the real client and `createReplayJevClient` so replay exercises
 * this parsing path too, not just a hand-typed `JevAnswer` fixture.
 */
export function parseJevResponse(raw: JevWireResponse): JevAnswer {
  const wantsStyleChange = parseNoulOptional(raw, 'wantsStyleChange');
  const wantsSaved = parseNoulOptional(raw, 'wantsSaved');
  const deviationIngredient = parseChoiceOptional(raw, 'deviationIngredient', Object.keys(DEVIATION_INGREDIENT_DESCRIPTIONS));
  const deviationFactor = parseChoiceOptional(raw, 'deviationFactor', Object.keys(DEVIATION_FACTOR_DESCRIPTIONS));
  return {
    route: parseChoice(raw, 'route', Object.keys(ROUTES) as Route[]),
    templateId: parseChoice(raw, 'templateId', Object.keys(TEMPLATE_DESCRIPTIONS) as TemplateId[]),
    theme: {
      palette: parseChoice(raw, 'palette', Object.keys(AXIS_DESCRIPTIONS.palette) as Palette[]),
      fontPairing: parseChoice(raw, 'fontPairing', Object.keys(AXIS_DESCRIPTIONS.fontPairing) as FontPairing[]),
      density: parseChoice(raw, 'density', Object.keys(AXIS_DESCRIPTIONS.density) as Density[]),
      radius: parseChoice(raw, 'radius', Object.keys(AXIS_DESCRIPTIONS.radius) as Radius[]),
      motif: parseChoice(raw, 'motif', Object.keys(AXIS_DESCRIPTIONS.motif) as Motif[]),
    },
    // Spread rather than assigned directly — `exactOptionalPropertyTypes`
    // treats `key: undefined` differently from an absent key, and "absent"
    // is what "not asked/not answered" should mean here.
    ...(wantsStyleChange !== undefined ? { wantsStyleChange } : {}),
    ...(wantsSaved !== undefined ? { wantsSaved } : {}),
    ...(deviationIngredient !== undefined ? { deviationIngredient } : {}),
    ...(deviationFactor !== undefined ? { deviationFactor } : {}),
    usage: { inputTokens: raw.usage?.input_tokens ?? 0, outputTokens: raw.usage?.output_tokens ?? 0 },
  };
}

function isStaleSocketError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  // A pooled keep-alive socket the server closed out from under us — never a
  // deadline/barge-in abort, which must propagate on the first try.
  return code === 'ECONNRESET' || code === 'EPIPE';
}

export type JevClientOptions = {
  /** Overridable for tests — a loopback http:// URL makes a black-hole/barge-in test possible with no real network. */
  baseUrl?: string;
  model?: string;
  maxRequests?: number;
  maxUsd?: number;
  /** The hard deadline (docs/orchestration-plan.md "Reliability"). */
  timeoutMs?: number;
};

/**
 * The real Jev HTTP client.
 *
 * Built on `node:https`/`node:http` with an explicit keep-alive agent, not
 * `fetch` — Node's global `fetch` (undici) only accepts an undici
 * `dispatcher` for connection pooling, and `undici` is not an installed
 * dependency. `http(s).request(url, { agent, signal })` gives the same
 * properties the task asks of "fetch": a signal that actually aborts the
 * in-flight request and releases the socket, which is what makes the hard
 * deadline real rather than merely give up waiting client-side.
 *
 * Connection reuse is the single biggest latency lever here (~260ms/63% of a
 * cold call is the TLS handshake) — hence the explicit persistent `agent`
 * instead of a fresh connection per call.
 */
export class JevHttpClient implements JevClient {
  private readonly key: string;
  private readonly url: URL;
  // `http` and `https` have the same `request`/`Agent` shape for the options
  // we use (method, agent, signal, headers) — cast to one type rather than
  // union the two namespaces, which TypeScript cannot call through cleanly
  // (overloaded functions don't combine across a union). Only ever
  // constructed from `this.url.protocol`, which is the actual dispatch.
  private readonly mod: typeof https;
  private readonly agent: https.Agent;
  private readonly model: string;
  private readonly maxRequests: number;
  private readonly maxUsd: number;
  private readonly timeoutMs: number;

  requests = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(options: JevClientOptions = {}) {
    this.key = loadKey();
    this.url = new URL(options.baseUrl ?? `https://${HOST}${PATH}`);
    this.mod = (this.url.protocol === 'http:' ? http : https) as unknown as typeof https;
    this.agent = new this.mod.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });
    this.model = options.model ?? 'jev-latest';
    this.maxRequests = options.maxRequests ?? 2000;
    this.maxUsd = options.maxUsd ?? 2.0;
    this.timeoutMs = options.timeoutMs ?? HARD_DEADLINE_MS;
  }

  get usd(): number {
    return this.inputTokens * USD_PER_INPUT_TOKEN;
  }

  /**
   * There is no ping endpoint — warming the connection means a real minimal
   * call. Minimal means minimal: one question, not the full 7-question batch
   * `ask` sends — this is a boot-path call, not a `decide` call, and there is
   * no reason to pay full input-token freight just to open a socket.
   */
  async warmup(): Promise<void> {
    const question: Record<string, JevChoiceQuestion> = { route: { type: 'choice', instructions: ROUTE_QUESTION, criteria: ROUTES } };
    await this.evaluate({ utterance: 'warmup', currentTemplate: null, taskState: '' }, question, AbortSignal.timeout(this.timeoutMs));
  }

  async ask(state: JevState, signal: AbortSignal): Promise<JevAnswer> {
    const { answer } = await this.askRecording(state, signal);
    return answer;
  }

  /**
   * Same as `ask`, but also hands back the raw wire response — used only by
   * the live fixture recorder (`live-jev.ts`/`record-fixtures.ts`), which
   * needs the full distribution on disk for P2, not just the parsed
   * `JevAnswer`.
   */
  async askRecording(state: JevState, signal: AbortSignal): Promise<{ answer: JevAnswer; raw: JevWireResponse }> {
    const raw = await this.evaluate(state, buildQuestions(), signal);
    return { answer: parseJevResponse(raw), raw };
  }

  /**
   * Ask an arbitrary `state` object, rather than a `JevState`.
   *
   * The structure composer (`contract/compose.ts`) builds its own wire state
   * — `user_request`/`context`/`guidance`/`capabilities` — and its own
   * `choice` questions, and must spend through THIS client so composition
   * shares the one credential, the one budget cap, the one keep-alive agent
   * and the one telemetry path with `decide`. Everything below this line is
   * the same code path `ask` takes.
   */
  async evaluateQuestions(
    state: Record<string, unknown>,
    questions: Record<string, JevQuestion>,
    signal: AbortSignal,
  ): Promise<JevWireResponse> {
    return this.evaluateWire(state, questions, signal);
  }

  private async evaluate(
    state: JevState,
    questions: Record<string, JevQuestion>,
    signal: AbortSignal,
  ): Promise<JevWireResponse> {
    return this.evaluateWire(buildWireState(state), questions, signal);
  }

  private async evaluateWire(
    state: Record<string, unknown>,
    questions: Record<string, JevQuestion>,
    signal: AbortSignal,
  ): Promise<JevWireResponse> {
    const body = JSON.stringify({ state, model: this.model, questions });
    // Barge-in and the hard deadline come from one object, so either one
    // actually tears down the socket rather than just stop waiting.
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const raw = await this.send(body, combined);

    this.inputTokens += raw.usage?.input_tokens ?? 0;
    this.outputTokens += raw.usage?.output_tokens ?? 0;
    return raw;
  }

  /**
   * One retry, only for a pooled socket the server closed between calls
   * (mirrors `_send_keepalive` in `backend/jev/client.py`). This is a
   * connection-reuse concern, not a general retry policy — a barge-in or
   * hard-deadline abort propagates on the first attempt (guarded twice: the
   * mapped error is no longer stale-socket-shaped once `request()` surfaces
   * `signal.reason` on an abort, AND `signal.aborted` is checked directly).
   */
  private async send(body: string, signal: AbortSignal): Promise<JevWireResponse> {
    try {
      return await this.attempt(body, signal);
    } catch (err) {
      if (!isStaleSocketError(err) || signal.aborted) throw err;
      return await this.attempt(body, signal);
    }
  }

  /**
   * One physical HTTP attempt, budget-checked and counted immediately before
   * it goes out — not after a response comes back. Counting only on success
   * means a transport that only ever throws (a `while` loop hammering a dead
   * endpoint, a retry storm) never increments `requests`, and the request cap
   * — the one thing meant to bound exactly that failure — never fires. A
   * retry from `send()` calls this again, so it counts as two requests, which
   * is what actually happened on the wire.
   */
  private attempt(body: string, signal: AbortSignal): Promise<JevWireResponse> {
    if (this.requests >= this.maxRequests) throw new JevBudgetError(`request cap reached (${this.maxRequests})`);
    if (this.usd >= this.maxUsd) throw new JevBudgetError(`spend cap reached ($${this.usd.toFixed(4)})`);
    this.requests += 1;
    return this.request(body, signal);
  }

  private request(body: string, signal: AbortSignal): Promise<JevWireResponse> {
    return new Promise((resolve, reject) => {
      // On an aborted signal, Node wraps it as a generic AbortError (or, if
      // the abort lands mid-*response*, as a bare `Error: aborted` with
      // `code: 'ECONNRESET'` on the response stream — indistinguishable from
      // a genuinely stale pooled socket unless mapped the same way here) and
      // puts the real reason (our `TimeoutError`, or the caller's barge-in
      // Error) one level down in `.cause`. Surface that reason directly on
      // BOTH the request's and the response's error event — the caller (and
      // `send()`'s stale-socket-retry check) needs to tell "hit the hard
      // deadline"/"barge-in" apart from "the pooled socket actually went
      // stale", not just "something aborted".
      const rejectWithReason = (err: unknown): void => reject(signal.aborted ? signal.reason : err);
      const req = this.mod.request(
        this.url,
        {
          method: 'POST',
          agent: this.agent,
          signal,
          headers: {
            Authorization: `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          // Always drain the body — an unconsumed response leaves the socket
          // unreturnable to the agent's keep-alive pool.
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`Jev ${res.statusCode}: ${text.slice(0, 500)}`));
              return;
            }
            try {
              resolve(JSON.parse(text) as JevWireResponse);
            } catch (cause) {
              reject(new Error('Jev: malformed JSON response', { cause }));
            }
          });
          res.on('error', rejectWithReason);
        },
      );
      req.on('error', rejectWithReason);
      req.end(body);
    });
  }
}

/**
 * The real HTTP client, constructed once per process so its keep-alive agent
 * and budget counters are actually shared across calls. Reading the key (and
 * therefore throwing if it is missing) happens lazily on first use, not at
 * import time — a wrong `Ctx` shape should fail loudly when it is USED, not
 * make every import of this module require a key.
 *
 * Exported as the concrete instance, not wrapped behind the bare `JevClient`
 * interface — whoever owns boot (P4) needs to call `.warmup()` on the SAME
 * instance it then puts on `Ctx.jev`, which a wrapper that only exposes
 * `ask` cannot do.
 */
let singleton: JevHttpClient | undefined;
export function getRealJevClient(): JevHttpClient {
  singleton ??= new JevHttpClient();
  return singleton;
}

/** Hand-written, deterministic. No network, safe for CI. */
export const stubJevClient: JevClient = {
  async ask(_state, signal): Promise<JevAnswer> {
    await sleep(20, signal);
    return {
      route: { value: 'query', confidence: 0.5, distribution: { query: 0.5 } },
      templateId: { value: 'generic_answer', confidence: 0.5, distribution: { generic_answer: 0.5 } },
      theme: {
        palette: { value: 'slate', confidence: 0.5, distribution: { slate: 0.5 } },
        fontPairing: { value: 'system', confidence: 0.5, distribution: { system: 0.5 } },
        density: { value: 'normal', confidence: 0.5, distribution: { normal: 0.5 } },
        radius: { value: 'soft', confidence: 0.5, distribution: { soft: 0.5 } },
        motif: { value: 'none', confidence: 0.5, distribution: { none: 0.5 } },
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  },
};

/** A recorded fixture: the wire request `state` alongside the raw wire `response`. */
export type JevFixture = { state: JevState; response: JevWireResponse };

/**
 * Reads a recorded response from disk and parses it through the same
 * `parseJevResponse` the real client uses, so replay exercises parsing too.
 *
 * Still threads `signal` through — an already-aborted turn must not return an
 * answer just because reading a fixture is fast. `sleep(0, signal)`, not
 * `signal.throwIfAborted()` — see `content.ts`'s matching comment: the latter
 * never yields, so a timer-scheduled abort would not land before this already
 * returned.
 */
export function createReplayJevClient(fixturePath: string): JevClient {
  return {
    async ask(_state, signal): Promise<JevAnswer> {
      await sleep(0, signal);
      const fixture = readFixture<JevFixture>(fixturePath);
      return parseJevResponse(fixture.response);
    },
  };
}
