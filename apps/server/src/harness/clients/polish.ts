import * as http from 'node:http';
import * as https from 'node:https';
import type { JsonValue } from '@jit/schema';
import { pythonJson, type ChatMessage } from './content-model.js';

/**
 * Agent 4 — generative polish.
 *
 * The architecture has always named this node; until now it did not exist,
 * and its absence is what made every generated surface look like every other
 * one. Agent 3 picks enum values from a four-palette table, which covers
 * latency and nothing else: with agent 4 missing, that table WAS the styling,
 * so the device could only ever wear one of four looks. CLAUDE.md is explicit
 * that the enum table "exists only to cover latency" and that adding presets
 * moves us back toward the lookup table we are not building — this is the
 * other half that claim depends on.
 *
 * It emits RAW tokens it invented: colours, a type scale, spacing, a radius,
 * a motif. They override the enum base on the axes they speak to and leave
 * the rest alone, so a patch that only reconsiders colour keeps the enum's
 * spacing.
 *
 * Two things constrain it, both enforced in `nodes/polish.ts` rather than
 * trusted to the prompt: unknown token names are dropped, and the merged
 * result is contrast-checked before it is allowed near the device.
 */

/** The axes agent 4 may speak to, with what each one must look like. */
const TOKEN_BRIEF = [
  '--jit-bg: page ground. A CSS hex colour.',
  '--jit-surface: the card sitting on the ground. Hex.',
  '--jit-border: hairline between regions. Hex.',
  '--jit-fg: body and heading text. Hex.',
  '--jit-muted: secondary text. Hex.',
  '--jit-accent: the one colour that carries emphasis. Hex.',
  '--jit-on-accent: text drawn ON the accent. Hex.',
  '--jit-accent-soft: a quiet wash of the accent. Hex.',
  '--jit-input: field interiors. Hex.',
  '--jit-font-display: a CSS font-family stack for headings.',
  '--jit-font-body: a CSS font-family stack for body text.',
  '--jit-weight-display: heading weight, 100-900, as a bare number.',
  '--jit-tracking-display: heading letter-spacing, e.g. "-0.02em".',
  '--jit-scale: type scale multiplier, e.g. "1.05".',
  '--jit-gap: space between siblings, e.g. "14px".',
  '--jit-pad: padding inside a card, e.g. "18px".',
  '--jit-radius: corner radius, e.g. "12px".',
  '--jit-radius-sm: the smaller radius, e.g. "6px".',
].join('\n');

/**
 * Only fonts that exist on the device.
 *
 * A stack naming a face Pi OS does not have silently falls through to the
 * generic, so an "editorial" surface would paint in the same sans as every
 * other one and the styling pass would look like it had not run. `Jost` is
 * the bundled woff2; the rest are what the OS actually ships.
 */
const AVAILABLE_FONTS =
  'Available families ONLY: Jost, Georgia, "Times New Roman", "Courier New", '
  + 'ui-monospace, system-ui, serif, sans-serif, monospace. Always end a stack '
  + 'with a generic (serif, sans-serif or monospace).';

function polishMessages(brief: PolishBrief): ChatMessage[] {
  const system = [
    'You are the visual designer for a generative interface. You are given',
    'what the user asked for and what the screen is about to show, and you',
    'return a token set that makes THIS surface look like it was designed for',
    'THIS question.',
    '',
    'Return a JSON object with exactly two keys:',
    '  "interpretedAs": one short phrase naming the look you chose.',
    '  "tokens": an object of CSS custom properties.',
    '',
    'Axes you may set (omit any you have no opinion on):',
    TOKEN_BRIEF,
    '',
    AVAILABLE_FONTS,
    '',
    'Rules:',
    '- The ground must stay DARK. A light --jit-bg is rejected whole.',
    '- Body and heading text must clear 4.5:1 against the ground and the',
    '  surface, and --jit-on-accent must clear 4.5:1 against --jit-accent.',
    '  A set that fails is thrown away entirely, so be decisive but legible.',
    '- Commit to a point of view. A cautious variation on grey is the same',
    '  failure as an unreadable one: it means the surface was not designed.',
    '- Let the SUBJECT drive it. A question about money should not look like',
    '  a question about a recipe.',
    '- Values only. No comments, no explanations, no markdown fences.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: pythonJson(brief as unknown as JsonValue) },
  ];
}

/** What agent 4 is told about the surface it is dressing. */
export type PolishBrief = {
  /** What the user actually said. */
  utterance: string;
  /** Which surface is up. */
  templateId: string;
  /** The shape it was composed in, when there was one. */
  layout?: string;
  /** The enum base agent 3 chose, as a starting point to depart from. */
  base: Record<string, string>;
};

export interface PolishSource {
  design(brief: PolishBrief, signal: AbortSignal): Promise<unknown>;
}

/**
 * Agent 4's budget is 400ms-2s (CLAUDE.md constraint 3), and it lands LAST —
 * the surface is already painted and readable when this call is in flight,
 * so a slow answer restyles something the user is looking at while an early
 * abort just means the enum base stands. Generous for that reason, and still
 * bounded so a hung request cannot outlive the turn.
 */
export const POLISH_DEADLINE_MS = 6000;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type ChatCompletion = { choices?: Array<{ message?: { content?: string } }> };

export type PolishOptions = { url?: string; apiKey?: string; model?: string; timeoutMs?: number };

export class OpenAiPolishSource implements PolishSource {
  private readonly url: URL;
  private readonly key: string | undefined;
  private readonly mod: typeof https;
  private readonly agent: https.Agent;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: PolishOptions = {}) {
    const url = options.url ?? process.env.JIT_POLISH_URL ?? OPENAI_URL;
    this.url = new URL(url);
    this.key = options.apiKey ?? process.env.JIT_POLISH_KEY ?? process.env.OPENAI_KEY;
    this.model = options.model ?? process.env.JIT_POLISH_MODEL ?? 'gpt-4o-mini';
    this.mod = (this.url.protocol === 'http:' ? http : https) as unknown as typeof https;
    this.agent = new this.mod.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });
    this.timeoutMs = options.timeoutMs ?? POLISH_DEADLINE_MS;
  }

  async design(brief: PolishBrief, signal: AbortSignal): Promise<unknown> {
    const body = JSON.stringify({
      model: this.model,
      messages: polishMessages(brief),
      response_format: { type: 'json_object' },
      // Warmer than `content`'s 0 on purpose: this is the one call in the
      // system whose job IS novelty. A deterministic designer would paint
      // every surface the same way, which is the defect this node exists to
      // fix. Bounded, not uncapped — an incoherent palette is not variety.
      temperature: 0.9,
      max_tokens: 700,
      stream: false,
    });
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const completion = await this.send(body, combined);
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Polish model returned no message content.');
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new Error(`Polish model returned non-JSON: ${text.slice(0, 200)}`, { cause });
    }
  }

  private send(body: string, signal: AbortSignal): Promise<ChatCompletion> {
    return new Promise((resolve, reject) => {
      const rejectWithReason = (err: unknown): void => reject(signal.aborted ? signal.reason : err);
      const req = this.mod.request(
        this.url,
        {
          method: 'POST',
          agent: this.agent,
          signal,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...(this.key ? { authorization: `Bearer ${this.key}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 400) {
              rejectWithReason(new Error(`Polish model HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
              return;
            }
            try {
              resolve(JSON.parse(text) as ChatCompletion);
            } catch (cause) {
              rejectWithReason(new Error(`Polish model returned non-JSON envelope: ${text.slice(0, 200)}`, { cause }));
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
 * Deterministic, no network. What tests and offline dev run against.
 *
 * It returns a REAL, contrast-passing token set rather than an empty one, so
 * the offline path exercises the same validate-and-merge code the live path
 * does. A stub that returned nothing would make every test pass through the
 * rejection branch and prove nothing about the accept branch.
 */
export const stubPolishSource: PolishSource = {
  async design(brief) {
    return {
      interpretedAs: `stub polish for ${brief.templateId}`,
      tokens: {
        '--jit-bg': '#0b0d10',
        '--jit-surface': '#14181d',
        '--jit-fg': '#f2f5f7',
        '--jit-muted': '#a8b3bd',
        '--jit-accent': '#7fd1c1',
        '--jit-on-accent': '#0b0d10',
        '--jit-radius': '10px',
      },
    };
  },
};
