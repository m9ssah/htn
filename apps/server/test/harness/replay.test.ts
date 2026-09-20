import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createReplayJevClient } from '../../src/harness/clients/jev.js';
import { createReplayContentSource } from '../../src/harness/clients/content.js';

// Deliberately not `new URL(\`...${x}\`, import.meta.url)` — Vite statically
// rewrites that two-argument pattern for asset bundling and mishandles a
// dynamic first argument, silently resolving to ".../undefined". Plain
// `node:path` joining sidesteps it.
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const fixture = (path: string): string => join(FIXTURES_DIR, path);

/**
 * "CI runs on stub + replay" (requirement 3) is only true if replay is
 * actually exercised. These are the replay tier's only callers.
 */
describe('replay clients', () => {
  it('createReplayJevClient reads a recorded answer from disk', async () => {
    const client = createReplayJevClient(fixture('jev/example.json'));

    const answer = await client.ask('anything', new AbortController().signal);

    expect(answer).toEqual({ templateId: 'choice_cards', confidence: 0.81 });
  });

  it('createReplayContentSource reads recorded chunks from disk', async () => {
    const source = createReplayContentSource(fixture('content/example.json'));

    const chunks: string[] = [];
    for await (const chunk of source.stream('anything', new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Add 2 cups flour', 'Add 1 tsp baking soda', 'Add a pinch of salt']);
  });

  /**
   * A replay client is meant to stand in for the real one in a cancellation
   * test (P3's done-when includes exactly that). If it ignored `signal`, it
   * would be the p19b failure mode itself: a node that keeps running after
   * everyone stopped listening — just with a fixture instead of a socket.
   */
  it('createReplayJevClient rejects if the signal is already aborted', async () => {
    const client = createReplayJevClient(fixture('jev/example.json'));
    const controller = new AbortController();
    controller.abort(new Error('barge-in'));

    await expect(client.ask('anything', controller.signal)).rejects.toThrow('barge-in');
  });

  it('createReplayContentSource stops yielding once the signal is aborted', async () => {
    const source = createReplayContentSource(fixture('content/example.json'));
    const controller = new AbortController();
    const chunks: string[] = [];

    const run = (async () => {
      for await (const chunk of source.stream('anything', controller.signal)) {
        chunks.push(chunk);
        controller.abort(new Error('barge-in')); // abort after the first chunk
      }
    })();

    await expect(run).rejects.toThrow('barge-in');
    expect(chunks).toEqual(['Add 2 cups flour']); // not all 3 — it stopped
  });
});
