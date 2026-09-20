import * as http from 'node:http';
import * as https from 'node:https';
import type { ContentGenerationRequestV1, JsonValue } from '@jit/schema';
import type { ContentModel } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

/**
 * The fine-tuned Stage 2 content model: Qwen2.5-3B-Instruct + a LoRA trained
 * on `training/content-model/dataset.jsonl`, served by vLLM on Baseten behind
 * an OpenAI-compatible `/v1/chat/completions`.
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

/** Content must land under 1.5s (CLAUDE.md constraint 3); past that the turn is better off reporting. */
export const CONTENT_DEADLINE_MS = 1500;

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

/** The two turns the model was trained on. Exported so the eval script prompts it identically. */
export function contentMessages(request: ContentGenerationRequestV1): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: pythonJson(request as unknown as JsonValue) },
  ];
}

export type ContentModelOptions = {
  /** Full chat-completions URL. Defaults to `JIT_CONTENT_MODEL_URL`. */
  url?: string;
  /** Defaults to `BASETEN_API`. */
  apiKey?: string;
  /**
   * vLLM serves the adapter under its LoRA module name, not the base model's
   * — `deploy.py`'s checkpoint name. Asking for the base model name silently
   * answers with the UNTRAINED base model, which is a wrong answer rather
   * than an error, so this is explicit.
   */
  model?: string;
  timeoutMs?: number;
};

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

/**
 * Built on `node:https` with a keep-alive agent for the same reason
 * `JevHttpClient` is: the TLS handshake dominates a cold call, and this sits
 * inside a 1.5s budget.
 */
export class BasetenContentModel implements ContentModel {
  private readonly url: URL;
  private readonly key: string;
  private readonly mod: typeof https;
  private readonly agent: https.Agent;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: ContentModelOptions = {}) {
    const url = options.url ?? process.env.JIT_CONTENT_MODEL_URL;
    if (!url) throw new Error('No content model URL: set JIT_CONTENT_MODEL_URL (see training/data-train/deploy.py).');
    const key = options.apiKey ?? process.env.BASETEN_API;
    if (!key) throw new Error('No Baseten API key: set BASETEN_API.');
    this.url = new URL(url);
    this.key = key;
    this.mod = (this.url.protocol === 'http:' ? http : https) as unknown as typeof https;
    this.agent = new this.mod.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });
    this.model = options.model ?? process.env.JIT_CONTENT_MODEL_NAME ?? 'checkpoint-51';
    this.timeoutMs = options.timeoutMs ?? CONTENT_DEADLINE_MS;
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
      messages: contentMessages(request),
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
            Authorization: `Api-Key ${this.key}`,
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
