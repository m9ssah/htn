import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JevBudgetError, JevHttpClient, parseJevResponse } from '../../src/harness/clients/jev.js';
import type { JevWireChoiceAnswer, JevWireResponse } from '../../src/harness/clients/jev.js';
import type { JevState } from '../../src/harness/types.js';

const VALID_ANSWERS: Record<string, JevWireChoiceAnswer> = {
  route: { type: 'choice', choice: 'query', confidence: 0.7, probabilities: { query: 0.7 } },
  templateId: { type: 'choice', choice: 'generic_answer', confidence: 0.6, probabilities: { generic_answer: 0.6 } },
  palette: { type: 'choice', choice: 'slate', confidence: 0.5, probabilities: { slate: 0.5 } },
  fontPairing: { type: 'choice', choice: 'system', confidence: 0.5, probabilities: { system: 0.5 } },
  density: { type: 'choice', choice: 'normal', confidence: 0.5, probabilities: { normal: 0.5 } },
  radius: { type: 'choice', choice: 'soft', confidence: 0.5, probabilities: { soft: 0.5 } },
  motif: { type: 'choice', choice: 'none', confidence: 0.5, probabilities: { none: 0.5 } },
};
const VALID_RESPONSE: JevWireResponse = {
  model: 'jev-latest',
  usage: { input_tokens: 10, output_tokens: 0 },
  answers: VALID_ANSWERS,
};
const STATE: JevState = { utterance: 'test', currentTemplate: null, taskState: '' };
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

describe('parseJevResponse', () => {
  it('throws when a question has no answer', () => {
    const { route: _dropped, ...rest } = VALID_ANSWERS;
    const broken = { ...VALID_RESPONSE, answers: rest };

    expect(() => parseJevResponse(broken)).toThrow('missing an answer for "route"');
  });

  it('throws when a choice value is not in the finite set it was asked with', () => {
    const badTemplateId: JevWireChoiceAnswer = { type: 'choice', choice: 'not_a_real_template', confidence: 0.9 };
    const broken: JevWireResponse = { ...VALID_RESPONSE, answers: { ...VALID_ANSWERS, templateId: badTemplateId } };

    expect(() => parseJevResponse(broken)).toThrow('unknown "templateId" value');
  });

  it('carries the full distribution through, not just the argmax', () => {
    const answer = parseJevResponse(VALID_RESPONSE);

    expect(answer.route.distribution).toEqual({ query: 0.7 });
  });
});

describe('JevHttpClient', () => {
  let server: Server | undefined;
  const originalKey = process.env.TYPESAFE_API_KEY;

  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key-never-sent-anywhere-real';
  });

  afterEach(async () => {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  function listen(handler: Handler): Promise<{ baseUrl: string; sockets: Socket[] }> {
    const sockets: Socket[] = [];
    server = createServer(handler);
    server.on('connection', (socket) => sockets.push(socket));
    return new Promise((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const { port } = server?.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${port}/v1/systemone`, sockets });
      });
    });
  }

  it('a round trip against a local server parses into a JevAnswer', async () => {
    const { baseUrl } = await listen((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(VALID_RESPONSE));
      });
    });
    const client = new JevHttpClient({ baseUrl, timeoutMs: 2000 });

    const answer = await client.ask(STATE, new AbortController().signal);

    expect(answer.templateId.value).toBe('generic_answer');
    expect(client.requests).toBe(1);
    expect(client.inputTokens).toBe(10);
  });

  it('reuses one socket across sequential calls — connection reuse is the point of the explicit Agent', async () => {
    const { baseUrl, sockets } = await listen((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(VALID_RESPONSE));
      });
    });
    const client = new JevHttpClient({ baseUrl, timeoutMs: 2000 });

    await client.ask(STATE, new AbortController().signal);
    await client.ask(STATE, new AbortController().signal);

    // If `agent` were silently dropped, each call would open its own TCP
    // connection and this would be 2, not 1 — the whole ~260ms/63% latency
    // saving this client exists for would be gone with the suite still green.
    expect(sockets).toHaveLength(1);
  });

  it(
    'a black hole (accepts, never responds) hits the hard deadline and releases the socket',
    { timeout: 10_000 },
    async () => {
      const { baseUrl, sockets } = await listen(() => {
        /* accept the connection, never write a response */
      });
      const client = new JevHttpClient({ baseUrl, timeoutMs: 150 });

      // A hard-deadline abort must surface as a TimeoutError specifically —
      // not just "something rejected" — because degradation handling
      // (docs/orchestration-plan.md "Reliability") treats a dead Jev
      // differently from a barge-in, and the caller can only tell them apart
      // if the rejection says which one happened.
      await expect(client.ask(STATE, new AbortController().signal)).rejects.toMatchObject({ name: 'TimeoutError' });

      expect(sockets).toHaveLength(1);
      await new Promise<void>((resolve) => {
        if (sockets[0]?.destroyed) resolve();
        else sockets[0]?.once('close', () => resolve());
      });
      expect(sockets[0]?.destroyed).toBe(true);
    },
  );

  it('an external abort (barge-in) tears down the in-flight request and its socket', async () => {
    const { baseUrl, sockets } = await listen(() => {
      /* accept the connection, never write a response */
    });
    const client = new JevHttpClient({ baseUrl, timeoutMs: 5000 });
    const controller = new AbortController();

    const run = client.ask(STATE, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 30)); // let the TCP connection establish
    controller.abort(new Error('barge-in'));

    // The caller's own abort reason, not a generic AbortError — same
    // property the replay client's matching test asserts.
    await expect(run).rejects.toThrow('barge-in');
    await new Promise<void>((resolve) => {
      if (sockets[0]?.destroyed) resolve();
      else sockets[0]?.once('close', () => resolve());
    });
    expect(sockets[0]?.destroyed).toBe(true);
  });

  it('an abort mid-response does not look like a stale socket and does not retry', async () => {
    let requestCount = 0;
    const { baseUrl } = await listen((_req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"mo'); // headers + a partial body; deliberately never res.end()
    });
    const client = new JevHttpClient({ baseUrl, timeoutMs: 5000 });
    const controller = new AbortController();

    const run = client.ask(STATE, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 30)); // let the partial response arrive
    controller.abort(new Error('barge-in'));

    // Same reason as a pre-response barge-in — not a generic/ECONNRESET-style
    // error that `isStaleSocketError` would mistake for a genuinely stale
    // pooled socket and retry, resurrecting a turn the caller already
    // cancelled.
    await expect(run).rejects.toThrow('barge-in');
    expect(client.requests).toBe(1);
    expect(requestCount).toBe(1);
  });

  it('throws a JevBudgetError before spending past the request cap', async () => {
    const client = new JevHttpClient({ baseUrl: 'http://127.0.0.1:1/v1/systemone', maxRequests: 0 });

    await expect(client.ask(STATE, new AbortController().signal)).rejects.toThrow(JevBudgetError);
  });

  it('a transport that only ever throws hits the request cap rather than looping forever', async () => {
    // Counters only update from a response, so a persistently-failing
    // transport (a dead endpoint, a retry storm) must still be bounded by
    // `requests` — the cap that exists precisely for this failure mode.
    const client = new JevHttpClient({ baseUrl: 'http://127.0.0.1:1/v1/systemone', maxRequests: 3, timeoutMs: 2000 });
    let calls = 0;
    (client as unknown as { request: (body: string, signal: AbortSignal) => Promise<unknown> }).request = () => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };

    for (let i = 0; i < 3; i++) {
      await expect(client.ask(STATE, new AbortController().signal)).rejects.toThrow('boom');
    }
    await expect(client.ask(STATE, new AbortController().signal)).rejects.toThrow(JevBudgetError);

    // Exactly 3 physical attempts happened, not a 4th — the cap fired
    // BEFORE a request went out, which is the property that actually bounds
    // a runaway loop.
    expect(calls).toBe(3);
  });

  it('throws a JevBudgetError before spending past the dollar cap', async () => {
    const client = new JevHttpClient({ baseUrl: 'http://127.0.0.1:1/v1/systemone', maxUsd: 0 });

    await expect(client.ask(STATE, new AbortController().signal)).rejects.toThrow(JevBudgetError);
  });

  it('retries once when the underlying request fails with a stale-socket error', async () => {
    const client = new JevHttpClient({ baseUrl: 'http://127.0.0.1:1/v1/systemone', timeoutMs: 2000 });
    let calls = 0;
    // The transport itself is exercised by the round-trip test above; this
    // isolates `send()`'s retry decision from real socket timing, which is
    // exactly the "pooled socket went stale between calls" case
    // (backend/jev/client.py `_send_keepalive`) — not reliably reproducible
    // by racing real OS socket teardown in a fast, non-flaky test.
    (client as unknown as { request: (body: string, signal: AbortSignal) => Promise<unknown> }).request = () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('socket hang up') as NodeJS.ErrnoException;
        err.code = 'ECONNRESET';
        return Promise.reject(err);
      }
      return Promise.resolve(VALID_RESPONSE);
    };

    const answer = await client.ask(STATE, new AbortController().signal);

    expect(calls).toBe(2);
    expect(answer.templateId.value).toBe('generic_answer');
  });

  it('does not retry a non-stale-socket failure', async () => {
    const client = new JevHttpClient({ baseUrl: 'http://127.0.0.1:1/v1/systemone', timeoutMs: 2000 });
    let calls = 0;
    (client as unknown as { request: (body: string, signal: AbortSignal) => Promise<unknown> }).request = () => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };

    await expect(client.ask(STATE, new AbortController().signal)).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
