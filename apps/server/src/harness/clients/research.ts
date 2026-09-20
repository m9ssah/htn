import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import type { FetchOutcome, ResearchClient } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

/**
 * The fetch half of Stage 2's search loop. No model, by design
 * (docs/ARCHITECTURE.md: "run the search / fetch — no model"); Jev judges the
 * results afterwards in its own batched call.
 */

/** A page past this is a document nobody is going to judge in 250ms. */
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 4000;

/**
 * The URLs this fetches are chosen by a model, which makes them untrusted
 * input, so the target is checked before a socket is opened:
 *
 * - **https only.** `http:` would leak the request, and `file:`/`ftp:` are not
 *   research.
 * - **No private or loopback destinations**, resolved rather than pattern
 *   matched — `http://localhost`, `http://127.0.0.1`, `169.254.169.254` (the
 *   cloud metadata endpoint) and any name that merely *resolves* to one are
 *   all the same SSRF, and a string check on the hostname catches only the
 *   first two.
 *
 * Returned as a reason rather than thrown: a blocked URL is a result the loop
 * should see and move past, not a crash.
 */
export async function checkTarget(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `not a URL: ${raw.slice(0, 80)}` };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: `refused ${url.protocol}//, https only` };

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch (err) {
    return { ok: false, reason: `cannot resolve ${url.hostname}: ${String(err)}` };
  }
  const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
  if (blocked) return { ok: false, reason: `refused ${url.hostname} — resolves to the private address ${blocked.address}` };

  return { ok: true, url };
}

export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const v6 = address.toLowerCase();
    // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local.
    return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

/** Real HTTPS GET, size- and time-bounded, with the target checked first. */
export const realResearchClient: ResearchClient = {
  async get(url, signal): Promise<FetchOutcome> {
    const target = await checkTarget(url);
    if (!target.ok) return { ok: false, reason: target.reason };
    const combined = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);

    return new Promise<FetchOutcome>((resolve) => {
      const req = https.request(target.url, { method: 'GET', signal: combined }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          // Stop reading rather than buffering a 40MB PDF into the turn.
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ ok: true, status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => resolve({ ok: false, reason: String(err) }));
      });
      req.on('error', (err) => resolve({ ok: false, reason: signal.aborted ? String(signal.reason) : String(err) }));
      req.end();
    });
  },
};

/** Hand-written, deterministic. No network, safe for CI. */
export const stubResearchClient: ResearchClient = {
  async get(url, signal): Promise<FetchOutcome> {
    await sleep(5, signal);
    return { ok: true, status: 200, body: `<html><body><p>Stub research body for ${url}</p></body></html>` };
  },
};

/** Replays a recorded map of url -> outcome. Unrecorded URLs are a miss, not an invention. */
export function createReplayResearchClient(fixturePath: string): ResearchClient {
  return {
    async get(url, signal): Promise<FetchOutcome> {
      await sleep(0, signal);
      const recorded = readFixture<Record<string, FetchOutcome>>(fixturePath);
      return recorded[url] ?? { ok: false, reason: `no recorded response for ${url}` };
    },
  };
}
