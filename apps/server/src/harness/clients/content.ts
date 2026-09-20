import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ContentSource } from '../types.js';
import { sleep } from '../signal.js';
import { readFixture } from './fixtures.js';

// `generate`'s protocol text goes in `prompt` (the user turn), not here —
// this stays fixed and content-free so the source itself never needs to know
// what a slot is.
const SYSTEM_PROMPT = 'Respond with nothing but the requested output. No prose, no markdown fences, no explanation.';

function extractTextDelta(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const e = event as Record<string, unknown>;
  if (e.type !== 'stream_event') return undefined;
  const inner = e.event as Record<string, unknown> | undefined;
  if (inner?.type !== 'content_block_delta') return undefined;
  const delta = inner.delta as Record<string, unknown> | undefined;
  return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : undefined;
}

/**
 * Shells out to `claude -p` — the fastest configuration probe 17 measured
 * (21,009 -> 922 input tokens, TTFT 5369ms -> 1605ms) and confirmed live
 * against this build: `--restricted --tools "" --strict-mcp-config
 * --mcp-config '{"mcpServers":{}}' --disable-slash-commands --system-prompt
 * <minimal>`. Never `--bare` — it skips keychain reads and breaks auth.
 *
 * `--output-format stream-json --include-partial-messages` is what makes
 * `content_block_delta` events arrive at all; without `--include-partial-
 * messages` the CLI only emits one complete `assistant` message at the end,
 * which would defeat "emit per slot as it parses." Confirmed live, not
 * assumed from `--help`.
 *
 * Two newline layers, not one: the CLI's own stream-json output is already
 * newline-delimited (`readline` on stdout is correct and sufficient for
 * that layer), but the *generated text* inside those events — `generate`'s
 * own JSON-Lines protocol — arrives in arbitrary-sized `text_delta` pieces
 * that can split a line at any character. `buf` re-assembles those before
 * this yields a line onward.
 */
export const realContentSource: ContentSource = {
  async *stream(prompt, signal): AsyncGenerator<string> {
    const child = spawn(
      'claude',
      [
        '-p',
        prompt,
        '--restricted',
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--disable-slash-commands',
        '--system-prompt',
        SYSTEM_PROMPT,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const onAbort = (): void => {
      child.kill();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    // Registered before the loop, not after — `close` can fire while we're
    // still draining stdout, and a listener added post-hoc would miss it.
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));

    const rl = createInterface({ input: child.stdout });
    let buf = '';
    let completed = false;
    try {
      for await (const wireLine of rl) {
        if (signal.aborted) break;
        let event: unknown;
        try {
          event = JSON.parse(wireLine);
        } catch {
          continue; // not every stdout line is JSON we care about
        }
        const text = extractTextDelta(event);
        if (text === undefined) continue;
        buf += text;
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          yield buf.slice(0, idx);
          buf = buf.slice(idx + 1);
        }
      }
      completed = true;
    } finally {
      signal.removeEventListener('abort', onAbort);
      rl.close();
      // Only a stopped-early consumer (abort, or `generate` throwing on a
      // malformed line mid-stream) needs the process killed. Killing it after
      // stdout hit EOF on its own races the process's own exit — SIGTERM can
      // still land while it's flushing session state, turning a successful
      // run into a fault via a null exit code below.
      if (!completed) child.kill();
    }

    if (signal.aborted) throw signal.reason;
    if (buf.trim()) yield buf; // a final line with no trailing newline at process exit

    const exitCode = await closed;
    if (exitCode !== 0) {
      throw new Error(`claude -p exited ${exitCode}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`);
    }
  },
};

/**
 * Hand-written, deterministic. Sleeps between chunks with the abortable
 * `sleep`, so this stub actually models cancellation rather than merely
 * declaring it — a node built on top of it is only cooperative if it also
 * threads `signal` through, but the stub itself cannot fake that away.
 *
 * `createStubCtx` wires this in as the default `content`, so it's what
 * `npm run node -- generate ...` runs against — the chunks are therefore
 * valid `generate` protocol lines for `generic_answer` (see
 * `harness/nodes/generate.ts`), not arbitrary text. `prompt` is unused: the
 * protocol is fixed regardless of what was asked.
 */
export const stubContentSource: ContentSource = {
  async *stream(_prompt, signal): AsyncGenerator<string> {
    const chunks = [
      '[]',
      '{"slot":"generic_answer.action","value":{"text":"Got it"}}',
      '{"slot":"generic_answer.title","value":{"text":"Stub title"}}',
      '{"slot":"generic_answer.body","value":{"text":"Stub body"}}',
      '{"slot":"generic_answer.point1","value":{"title":"Point one"}}',
      '{"slot":"generic_answer.point2","value":{"title":"Point two"}}',
      '{"slot":"generic_answer.point3","value":{"title":"Point three"}}',
    ];
    for (const chunk of chunks) {
      await sleep(15, signal);
      yield chunk;
    }
  },
};

/**
 * Reads a recorded chunk list from disk. CI-safe: no network, just a file
 * read.
 *
 * Checks `signal` between chunks like the stub does — a replay source that
 * ignored it would be the exact failure mode this file's `signal` doc warns
 * about (p19b: a node that never checks keeps running after everyone has
 * stopped listening), just with a fixture standing in for the network call.
 *
 * `sleep(0, signal)`, not `signal.throwIfAborted()`. The check has to be a
 * macrotask yield: `throwIfAborted()` returns synchronously and never yields
 * control, so an abort scheduled on a timer (as every real cancellation is —
 * `p19b`'s "user speaks again" case) would never get a turn to land before
 * all three chunks had already been read and yielded. `sleep(0, ...)` still
 * checks synchronously if `signal` is already aborted (see `signal.ts`), but
 * otherwise waits one tick, which is what actually gives a pending abort the
 * chance to fire between chunks. Replacing this with `throwIfAborted()` would
 * pass every test in this file and still leak the whole read on a real abort
 * — the same "green test proves nothing" trap the replay tier was just in.
 */
export function createReplayContentSource(fixturePath: string): ContentSource {
  return {
    async *stream(_prompt, signal): AsyncGenerator<string> {
      const chunks = readFixture<string[]>(fixturePath);
      for (const chunk of chunks) {
        await sleep(0, signal);
        yield chunk;
      }
    },
  };
}
