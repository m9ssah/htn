import * as http from 'node:http';
import * as https from 'node:https';
import type { ContentGenerationRequestV1, JsonValue } from '@jit/schema';
import type { ContentModel } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

/**
 * The fine-tuned Stage 2 content model, behind any OpenAI-compatible
 * `/v1/chat/completions` — vLLM, Together, Fireworks, Groq, an HF endpoint, a
 * local server. The provider is a URL and a key, deliberately: the adapter is
 * trained from `training/data-train/train.py` and wherever it ends up served
 * is not this layer's concern.
 *
 * It answers the `jit.content.request.v1` -> `jit.content.result.v1` contract
 * in `contract/content.ts`, which is the same contract it was trained on. It
 * fills prose only; every number on screen is still computed in TypeScript
 * from the domain model (CLAUDE.md constraint 2).
 */

/**
 * Verbatim from `training/data-train/train.py`. The model saw this exact
 * string as its system turn in all 270 training examples — paraphrasing it
 * here is a silent distribution shift, so the two must be edited together.
 */
const SYSTEM_PROMPT =
  'You fill named text fields on UI targets from a jit.content.request.v1 '
  + 'payload. Return only a jit.content.result.v1 JSON object mapping '
  + 'elementId to its field values. Never include a field marked as a '
  + 'business fact, never invent an elementId not in targets, and omit any '
  + 'optional field you have nothing for.';

/**
 * CLAUDE.md budgets content at 1.5s, and that is the number to design toward.
 * It is not the number to ABORT at: the skeleton has already painted by the
 * time this call is in flight, so a 2s answer fills a surface the user is
 * looking at, while a 1.5s abort leaves it shimmering and empty. Measured
 * against OpenAI, a generated answer lands in roughly 2-4s.
 */
export const CONTENT_DEADLINE_MS = 8000;

/**
 * Python's `json.dumps` defaults, reproduced.
 *
 * The training script serialised every request with `json.dumps(...)`, whose
 * defaults differ from `JSON.stringify` in two ways that change tokenisation:
 * `", "`/`": "` separators, and `ensure_ascii` escaping of everything at or
 * above U+007F. Sending JS-shaped JSON to a 3B model fine-tuned on 270
 * examples of the Python shape is an input it never saw, so this matches it
 * instead. `test/harness/content-model.test.ts` checks this against strings
 * emitted by Python itself rather than against hand-written expectations.
 *
 * Whole floats are the one unreachable difference — Python prints `1.0` where
 * JS prints `1` — and it cannot arise from a request that round-tripped
 * through JSON, where such a value is an int on both sides.
 */
export function pythonJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return escapeNonAscii(JSON.stringify(value));
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`;
  return `{${Object.entries(value).map(([key, child]) => `${escapeNonAscii(JSON.stringify(key))}: ${pythonJson(child)}`).join(', ')}}`;
}

const escapeNonAscii = (json: string): string =>
  json.replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** The two turns the fine-tuned model was trained on. Exported so an eval script prompts it identically. */
export function contentMessages(request: ContentGenerationRequestV1): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: pythonJson(request as unknown as JsonValue) },
  ];
}

/**
 * The same task, spelled out for a model that has NOT been fine-tuned on it.
 *
 * `SYSTEM_PROMPT` is terse because the LoRA learned the contract from 270
 * examples; a stock instruct model has seen none of them and needs the rules
 * stated. Keeping the two separate rather than widening one is deliberate:
 * lengthening the trained prompt would shift the fine-tune's input
 * distribution, and shortening this one would leave a stock model guessing at
 * a contract it has never seen.
 *
 * The request still goes over as `pythonJson` so a single fixture proves both
 * paths send byte-identical payloads.
 */
export function instructedContentMessages(request: ContentGenerationRequestV1): ChatMessage[] {
  const system = [
    'You fill named text fields on a generated UI surface.',
    '',
    'You receive a jit.content.request.v1 JSON payload. Reply with ONLY a',
    'jit.content.result.v1 JSON object — no prose, no markdown, no code fences.',
    '',
    '`intent` is what the person actually said, and everything you write must',
    'respond to IT. `context` is background about what is already on screen —',
    'use it only where the intent refers to it. When the two are unrelated,',
    'follow the intent and ignore the context completely: answering "my name',
    'is Sam" with the current recipe step is the failure to avoid.',
    '',
    'Shape your reply exactly like this, echoing requestId and catalogVersion',
    'from the request:',
    '{"contract":"jit.content.result.v1","requestId":"...","catalogVersion":"...",',
    ' "values":{"<elementId>":{"<field>":"<text>"}}}',
    '',
    'Rules:',
    '- One entry in `values` per target in `targets`, keyed by its elementId.',
    '  Never invent an elementId that is not in targets.',
    '- Write every field marked required. Omit an optional field you have',
    '  nothing good for — omit the key entirely, never send null.',
    '- Respect each field\'s maxLength. Shorter is better than truncated.',
    '- Plain text only. No markdown, no quotes around the value, no trailing',
    '  punctuation on headings or button labels.',
    '- `fixed` and `sourceFacts` are facts already computed for you. Use them',
    '  to inform wording, but never restate a number as a field you generate.',
    '- Write for a 4-inch touch screen: concrete, specific, and short.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: pythonJson(request as unknown as JsonValue) },
  ];
}

export type ContentModelOptions = {
  /** Full chat-completions URL. Defaults to `JIT_CONTENT_MODEL_URL`. */
  url?: string;
  /** Defaults to `JIT_CONTENT_MODEL_KEY`. Optional — a local server needs none. */
  apiKey?: string;
  /**
   * Which model the endpoint should answer with. Server-side LoRA hosting
   * usually serves the adapter under its OWN name rather than the base
   * model's, and naming the base model there silently answers with the
   * UNTRAINED weights — a wrong answer rather than an error — so this is
   * explicit rather than defaulted.
   */
  model?: string;
  timeoutMs?: number;
  /**
   * `instructed` (the default) states the contract in full, for a stock
   * model. `trained` sends the terse prompt the LoRA was fine-tuned on — use
   * it only against an endpoint serving that adapter, where the long prompt
   * would be off-distribution.
   */
  prompt?: 'instructed' | 'trained';
  /**
   * Ask the endpoint to constrain decoding to JSON. On by default because the
   * single most common stock-model failure here is a ```json fence, which
   * `fill` can only reject. Turn it off for a host that rejects the parameter.
   */
  jsonMode?: boolean;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

/**
 * Built on `node:https` with a keep-alive agent for the same reason
 * `JevHttpClient` is: the TLS handshake dominates a cold call, and this sits
 * inside a 1.5s budget.
 */
export class OpenAiContentModel implements ContentModel {
  private readonly url: URL;
  private readonly key: string | undefined;
  private readonly mod: typeof https;
  private readonly agent: https.Agent;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly buildMessages: (request: ContentGenerationRequestV1) => ChatMessage[];
  private readonly jsonMode: boolean;

  constructor(options: ContentModelOptions = {}) {
    // OpenAI itself is the default host, so `OPENAI_KEY` alone is a working
    // configuration; any other OpenAI-compatible host is one env var away.
    const url = options.url ?? process.env.JIT_CONTENT_MODEL_URL ?? OPENAI_URL;
    const model = options.model ?? process.env.JIT_CONTENT_MODEL_NAME
      ?? (url === OPENAI_URL ? 'gpt-4o-mini' : undefined);
    if (!model) throw new Error('No content model name: set JIT_CONTENT_MODEL_NAME to the served adapter, not the base model.');
    this.url = new URL(url);
    // Absent rather than empty when unset: a local vLLM/Ollama needs no key,
    // and sending `Bearer undefined` would fail in a way that reads like a
    // credential problem instead of a missing one.
    this.key = options.apiKey ?? process.env.JIT_CONTENT_MODEL_KEY ?? process.env.OPENAI_KEY;
    this.mod = (this.url.protocol === 'http:' ? http : https) as unknown as typeof https;
    this.agent = new this.mod.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });
    this.model = model;
    this.timeoutMs = options.timeoutMs ?? CONTENT_DEADLINE_MS;
    this.buildMessages = (options.prompt ?? process.env.JIT_CONTENT_MODEL_PROMPT) === 'trained'
      ? contentMessages
      : instructedContentMessages;
    this.jsonMode = options.jsonMode ?? true;
  }

  /**
   * Returns what the model said, parsed as JSON and otherwise untouched —
   * `validateContentResult` is what decides whether any of it is usable, and
   * it needs the raw shape to reject against. Nothing here repairs, retries
   * or substitutes: a failure throws and the caller reports it (constraint 5).
   */
  async fill(request: ContentGenerationRequestV1, signal: AbortSignal): Promise<unknown> {
    const body = JSON.stringify({
      model: this.model,
      messages: this.buildMessages(request),
      ...(this.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      // Deterministic: the contract is a fixed shape, not a creative task,
      // and a judge re-asking the same thing should not get a different
      // surface. `max_tokens` bounds the tail a runaway generation could add
      // to the turn.
      temperature: 0,
      max_tokens: 512,
      stream: false,
    });
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const completion = await this.send(body, combined);
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Content model returned no message content.');
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new Error(`Content model returned non-JSON: ${text.slice(0, 200)}`, { cause });
    }
  }

  private send(body: string, signal: AbortSignal): Promise<ChatCompletion> {
    return new Promise((resolve, reject) => {
      // Same reason as `JevHttpClient.request`: Node wraps an abort as a
      // generic AbortError and hides the real reason (our timeout, or the
      // turn's barge-in) in `.cause`. Surface the reason the caller can act on.
      const rejectWithReason = (err: unknown): void => reject(signal.aborted ? signal.reason : err);
      const req = this.mod.request(
        this.url,
        {
          method: 'POST',
          agent: this.agent,
          signal,
          headers: {
            ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`Content model ${res.statusCode}: ${text.slice(0, 500)}`));
              return;
            }
            try {
              resolve(JSON.parse(text) as ChatCompletion);
            } catch (cause) {
              reject(new Error('Content model: malformed JSON response', { cause }));
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
 * Echoes the request back as a well-formed result: every required field gets
 * a placeholder string, optional fields are omitted. No network, deterministic
 * — what `npm test` and offline dev run against.
 *
 * It is deliberately not "good" content. A stub that wrote plausible copy
 * would make a broken model endpoint look like a working one on stage.
 */
export const stubContentModel: ContentModel = {
  async fill(request, signal): Promise<unknown> {
    await sleep(5, signal);
    const values: Record<string, Record<string, JsonValue>> = {};
    for (const target of request.targets) {
      const filled: Record<string, JsonValue> = {};
      for (const field of target.fields) {
        if (!field.required) continue;
        filled[field.name] = field.type === 'number' ? 0
          : field.type === 'boolean' ? false
            : field.type === 'number[]' ? []
              : `[${target.elementId}.${field.name}]`.slice(0, field.constraints?.maxLength ?? 64);
      }
      values[target.elementId] = filled;
    }
    return { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values };
  },
};

/** Reads a recorded model response from disk. Checks `signal` like the other replay clients do. */
export function createReplayContentModel(fixturePath: string): ContentModel {
  return {
    async fill(_request, signal): Promise<unknown> {
      await sleep(0, signal);
      return readFixture<unknown>(fixturePath);
    },
  };
}
