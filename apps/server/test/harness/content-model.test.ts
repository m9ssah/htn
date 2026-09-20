import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentGenerationRequestV1, JsonValue } from '@jit/schema';
import { BasetenContentModel, contentMessages, pythonJson, stubContentModel } from '../../src/harness/clients/content-model.js';
import { readFixture } from '../../src/harness/clients/fixtures.js';
import { validateContentResult } from '../../src/contract/content.js';

const REQUEST: ContentGenerationRequestV1 = {
  contract: 'jit.content.request.v1',
  requestId: 'req-1',
  catalogVersion: 'jit-device.v2',
  locale: 'en-CA',
  intent: 'Show the selected recipe',
  context: {},
  targets: [
    {
      elementId: 'title',
      component: 'Heading',
      purpose: 'Heading on the generated surface',
      fields: [{ name: 'text', type: 'string', required: true, constraints: { maxLength: 48, format: 'plain-text' } }],
      fixed: { level: 1 },
    },
    {
      elementId: 'note',
      component: 'Text',
      purpose: 'Text on the generated surface',
      fields: [{ name: 'text', type: 'string', required: true, constraints: { maxLength: 160, format: 'plain-text' } }],
      fixed: {},
    },
  ],
};

const RESULT = {
  contract: 'jit.content.result.v1',
  requestId: 'req-1',
  catalogVersion: 'jit-device.v2',
  values: { title: { text: 'Classic Chocolate Chip' }, note: { text: 'Twelve minutes at 180C.' } },
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The prompt is the model's input distribution, so this is checked against
 * strings Python itself emitted (`fixtures/content-model/python-json.json`,
 * generated from real dataset requests across all six locales plus escaping
 * edge cases), not against expectations hand-written here. A hand-written
 * expectation would only prove this file agrees with itself.
 */
describe('pythonJson', () => {
  const cases = readFixture<Array<{ value: JsonValue; expected: string }>>('apps/server/fixtures/content-model/python-json.json');

  it('reproduces python json.dumps for every recorded case', () => {
    expect(cases.length).toBeGreaterThan(12);
    for (const { value, expected } of cases) expect(pythonJson(value)).toBe(expected);
  });

  it('differs from JSON.stringify exactly where json.dumps does — separators and non-ASCII', () => {
    expect(pythonJson({ a: 1, b: 'ほ' } as JsonValue)).toBe('{"a": 1, "b": "\\u307b"}');
    expect(JSON.stringify({ a: 1, b: 'ほ' })).toBe('{"a":1,"b":"ほ"}');
  });
});

describe('contentMessages', () => {
  it('sends the training system prompt verbatim and the request as the user turn', () => {
    const messages = contentMessages(REQUEST);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    // Verbatim from training/data-train/train.py's SYSTEM_PROMPT.
    expect(messages[0]?.content).toBe(
      'You fill named text fields on UI targets from a jit.content.request.v1 '
      + 'payload. Return only a jit.content.result.v1 JSON object mapping '
      + 'elementId to its field values. Never include a field marked as a '
      + 'business fact, never invent an elementId not in targets, and omit any '
      + 'optional field you have nothing for.',
    );
    expect(messages[1]?.content).toBe(pythonJson(REQUEST as unknown as JsonValue));
  });
});

describe('stubContentModel', () => {
  it('answers the contract it was asked — a stub that failed validation would hide a real break', async () => {
    const raw = await stubContentModel.fill(REQUEST, new AbortController().signal);

    const validation = validateContentResult(REQUEST, raw);
    expect(validation.rejected).toEqual([]);
    expect(Object.keys(validation.result.values).sort()).toEqual(['note', 'title']);
  });

  it('is obviously placeholder copy, so a stubbed endpoint never reads as a working one', async () => {
    const raw = await stubContentModel.fill(REQUEST, new AbortController().signal) as typeof RESULT;

    expect(raw.values.title?.text).toBe('[title.text]');
  });
});

describe('BasetenContentModel', () => {
  let server: Server | undefined;

  beforeEach(() => {
    process.env.BASETEN_API = 'test-key-never-sent-anywhere-real';
  });

  afterEach(async () => {
    delete process.env.BASETEN_API;
    delete process.env.JIT_CONTENT_MODEL_URL;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  function listen(handler: Handler): Promise<string> {
    server = createServer(handler);
    return new Promise((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const { port } = server?.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}/v1/chat/completions`);
      });
    });
  }

  const respond = (body: unknown): Handler => (req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };

  const completion = (content: string): unknown => ({ choices: [{ message: { content } }] });

  it('round-trips a chat completion into the raw result the validator can judge', async () => {
    const url = await listen(respond(completion(JSON.stringify(RESULT))));
    const model = new BasetenContentModel({ url, timeoutMs: 2000 });

    const raw = await model.fill(REQUEST, new AbortController().signal);

    expect(validateContentResult(REQUEST, raw).rejected).toEqual([]);
  });

  it('asks for the LoRA module by name — the base model name would answer untrained', async () => {
    let seen = '';
    const url = await listen((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      req.on('end', () => {
        seen = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(completion(JSON.stringify(RESULT))));
      });
    });
    const model = new BasetenContentModel({ url, model: 'checkpoint-51', timeoutMs: 2000 });

    await model.fill(REQUEST, new AbortController().signal);

    const sent = JSON.parse(seen) as { model: string; temperature: number; messages: unknown[] };
    expect(sent.model).toBe('checkpoint-51');
    expect(sent.temperature).toBe(0);
    expect(sent.messages).toEqual(contentMessages(REQUEST));
  });

  it('sends the Baseten Api-Key authorization header', async () => {
    let auth: string | undefined;
    const url = await listen((req, res) => {
      auth = req.headers.authorization;
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(completion(JSON.stringify(RESULT))));
      });
    });
    const model = new BasetenContentModel({ url, timeoutMs: 2000 });

    await model.fill(REQUEST, new AbortController().signal);

    expect(auth).toBe('Api-Key test-key-never-sent-anywhere-real');
  });

  it('throws on prose instead of JSON rather than passing a fallback downstream', async () => {
    const url = await listen(respond(completion('Sure, here is your result!')));
    const model = new BasetenContentModel({ url, timeoutMs: 2000 });

    await expect(model.fill(REQUEST, new AbortController().signal)).rejects.toThrow('non-JSON');
  });

  it('surfaces an HTTP error instead of an empty surface', async () => {
    const url = await listen((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end('{"error":"cold start"}');
      });
    });
    const model = new BasetenContentModel({ url, timeoutMs: 2000 });

    await expect(model.fill(REQUEST, new AbortController().signal)).rejects.toThrow('Content model 503');
  });

  it('a barge-in aborts the in-flight request with the caller reason, not a generic AbortError', async () => {
    const url = await listen(() => { /* black hole: never answers */ });
    const model = new BasetenContentModel({ url, timeoutMs: 5000 });
    const controller = new AbortController();
    const bargeIn = new Error('barge-in');

    const pending = model.fill(REQUEST, controller.signal);
    controller.abort(bargeIn);

    await expect(pending).rejects.toThrow('barge-in');
  });

  it('gives up at the deadline rather than holding the turn open', async () => {
    const url = await listen(() => { /* black hole */ });
    const model = new BasetenContentModel({ url, timeoutMs: 50 });

    await expect(model.fill(REQUEST, new AbortController().signal)).rejects.toThrow(/timed out/i);
  });

  it('refuses to construct without a URL, rather than defaulting to somewhere', () => {
    expect(() => new BasetenContentModel()).toThrow('JIT_CONTENT_MODEL_URL');
  });
});
