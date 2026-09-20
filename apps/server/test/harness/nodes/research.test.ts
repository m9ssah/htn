import { describe, expect, it } from 'vitest';
import { research } from '../../../src/harness/nodes/research.js';
import { createStubCtx } from '../../../src/harness/ctx.js';
import { checkTarget, isPrivateAddress, stubResearchClient, createReplayResearchClient } from '../../../src/harness/clients/research.js';
import type { Ctx, FetchOutcome, ResearchClient } from '../../../src/harness/types.js';

const ctxWith = (fetch: ResearchClient, signal = new AbortController().signal): Ctx => ({
  ...createStubCtx(signal),
  fetch,
});

const ok = (body: string): FetchOutcome => ({ ok: true, status: 200, body });

/**
 * The URLs reaching this node are produced by a model, so they are untrusted
 * input and the guard is a security boundary rather than a tidiness check.
 */
describe('checkTarget', () => {
  it('refuses anything that is not https', async () => {
    await expect(checkTarget('http://example.com')).resolves.toMatchObject({ ok: false });
    await expect(checkTarget('file:///etc/passwd')).resolves.toMatchObject({ ok: false });
    await expect(checkTarget('ftp://example.com')).resolves.toMatchObject({ ok: false });
  });

  it('refuses a malformed URL rather than throwing', async () => {
    await expect(checkTarget('not a url')).resolves.toMatchObject({ ok: false });
  });

  it('refuses loopback even when it is spelled as a hostname', async () => {
    // `localhost` resolves to 127.0.0.1, which a string check on the
    // hostname would miss.
    const result = await checkTarget('https://localhost/admin');

    expect(result.ok).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  it('blocks loopback, the RFC1918 ranges, and link-local', () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '172.31.255.1', '192.168.1.1', '0.0.0.0', '169.254.169.254']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('blocks the cloud metadata endpoint specifically', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('blocks IPv6 loopback and unique-local', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('treats an unparseable address as private rather than assuming it is safe', () => {
    expect(isPrivateAddress('banana')).toBe(true);
  });
});

describe('research', () => {
  it('fetches every candidate and returns what came back', async () => {
    const seen: string[] = [];
    const client: ResearchClient = {
      async get(url): Promise<FetchOutcome> {
        seen.push(url);
        return ok(`body of ${url}`);
      },
    };

    const result = await research.run({ urls: ['https://a.test/1', 'https://b.test/2'] }, ctxWith(client));

    expect(seen).toHaveLength(2);
    expect(result.findings.map((f) => f.url)).toEqual(['https://a.test/1', 'https://b.test/2']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the candidates that answered when one fails', async () => {
    const client: ResearchClient = {
      async get(url): Promise<FetchOutcome> {
        return url.includes('bad') ? { ok: false, reason: 'ENOTFOUND' } : ok('fine');
      },
    };

    const result = await research.run({ urls: ['https://bad.test/x', 'https://good.test/y'] }, ctxWith(client));

    expect(result.findings).toHaveLength(2);
    expect(result.findings.filter((f) => f.outcome.ok)).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('ENOTFOUND');
  });

  it('stays total when the client throws instead of returning', async () => {
    const client: ResearchClient = {
      async get(): Promise<FetchOutcome> {
        throw new Error('client blew up');
      },
    };

    const result = await research.run({ urls: ['https://a.test/1'] }, ctxWith(client));

    expect(result.findings[0]?.outcome).toMatchObject({ ok: false });
    expect(result.warnings.join(' ')).toContain('client blew up');
  });

  it('de-duplicates, so one source cannot be counted as two agreeing ones', async () => {
    let calls = 0;
    const client: ResearchClient = { async get(): Promise<FetchOutcome> { calls += 1; return ok('x'); } };

    const result = await research.run({ urls: ['https://a.test/1', 'https://a.test/1'] }, ctxWith(client));

    expect(calls).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('duplicate');
  });

  it('names the candidates it dropped at the cap rather than silently truncating', async () => {
    const client: ResearchClient = { async get(): Promise<FetchOutcome> { return ok('x'); } };
    const urls = ['1', '2', '3', '4'].map((n) => `https://a.test/${n}`);

    const result = await research.run({ urls, maxUrls: 2 }, ctxWith(client));

    expect(result.findings).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('https://a.test/3');
    expect(result.warnings.join(' ')).toContain('https://a.test/4');
  });

  it('runs candidates concurrently — serialising a round breaks the latency budget', async () => {
    let inFlight = 0;
    let peak = 0;
    const client: ResearchClient = {
      async get(): Promise<FetchOutcome> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return ok('x');
      },
    };

    await research.run({ urls: ['1', '2', '3'].map((n) => `https://a.test/${n}`) }, ctxWith(client));

    expect(peak).toBeGreaterThan(1);
  });

  it('threads the turn signal, so a barge-in stops the round', async () => {
    const controller = new AbortController();
    const client: ResearchClient = {
      async get(_url, signal): Promise<FetchOutcome> {
        return signal.aborted ? { ok: false, reason: 'aborted' } : ok('x');
      },
    };
    controller.abort(new Error('barge-in'));

    const result = await research.run({ urls: ['https://a.test/1'] }, ctxWith(client, controller.signal));

    expect(result.findings[0]?.outcome).toMatchObject({ ok: false, reason: 'aborted' });
  });
});

describe('research doubles', () => {
  it('the stub answers without a network', async () => {
    const outcome = await stubResearchClient.get('https://a.test/1', new AbortController().signal);

    expect(outcome).toMatchObject({ ok: true, status: 200 });
  });

  it('replay reports an unrecorded URL as a miss rather than inventing a body', async () => {
    const client = createReplayResearchClient('apps/server/fixtures/content-model/python-json.json');

    const outcome = await client.get('https://not.recorded/x', new AbortController().signal);

    expect(outcome).toMatchObject({ ok: false });
  });
});
