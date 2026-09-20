import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentPatch, Patch } from '@jit/schema';
import { startTurn, createTurnRunner, type Turn } from '../../src/harness/turn.js';
import {
  deps,
  emitThenThrow,
  emitter,
  oneNodeGraph,
  patch,
  patchLabel,
  signalIgnoringEmitter,
  sleep,
  twoNodeGraph,
} from './doubles.js';
import type { Ctx, Node } from '../../src/harness/types.js';

const drain = async (turn: Turn, lagMs = 0): Promise<string[]> => {
  const got: string[] = [];
  for await (const p of turn.patches) {
    got.push(patchLabel(p));
    if (lagMs) await sleep(lagMs);
  }
  return got;
};

describe('turn: streaming', () => {
  /**
   * Deterministic, not timing-based: the second node cannot finish until the
   * test resolves a promise, and the test does not resolve it until it has
   * already received the first node's patch. If patches were batched at
   * graph exit this deadlocks and the test times out.
   */
  it('delivers a patch to the consumer while a later node is still running', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondFinished = false;

    const second: Node<void, void> = {
      name: 'second',
      async run(_input, ctx: Ctx): Promise<void> {
        await held;
        secondFinished = true;
        ctx.sink.emit(patch(2));
      },
    };

    const turn = startTurn({ step: 0 }, deps(twoNodeGraph(emitter(1), second)));

    const got: string[] = [];
    for await (const p of turn.patches) {
      got.push(patchLabel(p));
      if (got.length === 1) {
        // Holding patch 1 while `second` is provably still blocked.
        expect(secondFinished).toBe(false);
        release();
      }
    }

    expect(got).toEqual(['patch 1', 'patch 2']);
    expect(turn.firstPatchMs).not.toBeNull();
  });
});

describe('turn: crash under a slow consumer', () => {
  /**
   * The headline. `p19c` measured that letting a node's error reach the
   * LangGraph stream controller resets its queue — 6 writes before a throw
   * delivered 6/6 at 0ms consumer lag but only 3/6 at 150ms and 2/6 at
   * 300ms. `runGuarded` catches inside the node wrapper and returns normally
   * (`p19d`), so nothing already emitted is lost at any lag.
   *
   * 0ms is included on purpose: it is the lag at which the BROKEN version
   * also passes, so its presence documents why the other two rows exist.
   */
  it.each([0, 150, 300])('loses zero already-emitted patches at %ims consumer lag', async (lag) => {
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitThenThrow(6, 0))));
    const got = await drain(turn, lag);

    expect(got).toEqual(['patch 1', 'patch 2', 'patch 3', 'patch 4', 'patch 5', 'patch 6']);
    // The turn ends normally — the crash is a logged fault, not an exception
    // at the consumer, because an exception is what discards the queue.
    const faults = turn.log.entries.filter((e) => e.kind === 'fault');
    expect(faults).toHaveLength(1);
    expect(faults[0]?.reason).toBe('node-crashed');
  });

  it('records the crash in the turn log even though the consumer sees no error', async () => {
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitThenThrow(2, 0))));
    await expect(drain(turn, 150)).resolves.toHaveLength(2);
    const fault = turn.log.entries.find((e) => e.kind === 'fault');
    expect(String(fault?.error)).toContain('exploded after 2 patches');
  });
});

describe('turn: barge-in', () => {
  it('emits zero patches after abort, even when the node ignores the signal', async () => {
    const attempts: number[] = [];
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(signalIgnoringEmitter(8, 10, attempts))));

    const got: string[] = [];
    for await (const p of turn.patches) {
      got.push(patchLabel(p));
      if (got.length === 2) turn.abort(new Error('barge-in: user spoke again'));
    }

    // The node kept running — that is the p19b finding, and the point of the
    // test: the guarantee cannot come from the node.
    expect(attempts.length).toBeGreaterThan(got.length);
    // Nothing past the abort reached the consumer.
    expect(got).toEqual(['patch 1', 'patch 2']);
    // And every attempt past it was reported, not silently swallowed.
    const dropped = turn.log.entries.filter((e) => e.kind === 'patch-dropped');
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((e) => e.reason === 'aborted' || e.reason === 'closed')).toBe(true);
  });

  it('a node that cooperates with the signal stops, and the turn reports aborted', async () => {
    const cooperative: Node<void, void> = {
      name: 'cooperative',
      async run(_input, ctx: Ctx): Promise<void> {
        for (let i = 1; i <= 8; i += 1) {
          await sleep(10);
          ctx.signal.throwIfAborted();
          ctx.sink.emit(patch(i));
        }
      },
    };
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(cooperative)));
    const got: string[] = [];
    for await (const p of turn.patches) {
      got.push(patchLabel(p));
      if (got.length === 1) turn.abort();
    }
    expect(got).toEqual(['patch 1']);
    const fault = turn.log.entries.find((e) => e.kind === 'fault');
    expect(fault?.reason).toBe('aborted');
  });

  it('a consumer that breaks out of the loop aborts the turn rather than leaking the node', async () => {
    const attempts: number[] = [];
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(signalIgnoringEmitter(6, 10, attempts))));

    for await (const p of turn.patches) {
      void p;
      break; // the consumer walks away — p19b: nothing else stops the node
    }

    await sleep(80);
    expect(turn.log.entries.some((e) => e.kind === 'abort')).toBe(true);
    // Whatever the leaked node still tried to emit went nowhere.
    expect(turn.log.entries.filter((e) => e.kind === 'patch')).toHaveLength(1);
  });
});

describe('turn: stale-turn isolation', () => {
  it('a patch from an aborted turn never lands in a later turn', async () => {
    const firstAttempts: number[] = [];
    const runner = createTurnRunner(deps(oneNodeGraph(signalIgnoringEmitter(10, 10, firstAttempts))));

    const first = runner.say({ step: 0 });
    const firstGot: string[] = [];
    for await (const p of first.patches) {
      firstGot.push(patchLabel(p));
      break;
    }

    // Second utterance while the first node is demonstrably still running.
    const second = runner.say({ step: 0 });
    const secondGot = await drain(second);

    expect(firstAttempts.length).toBeGreaterThan(firstGot.length);
    // Both turns produced their own patches and neither saw the other's.
    expect(secondGot.length).toBeGreaterThan(0);
    expect(first.turnId).not.toBe(second.turnId);
    const secondPatchEntries = second.log.entries.filter((e) => e.kind === 'patch');
    expect(secondPatchEntries).toHaveLength(secondGot.length);
    // The first turn's leaked emits were dropped and reported against the
    // FIRST turn's log, so grepping the second turn's id never shows them.
    expect(first.log.entries.some((e) => e.kind === 'patch-dropped')).toBe(true);
  });

  it('starting a second turn aborts the first', async () => {
    const runner = createTurnRunner(deps(oneNodeGraph(emitter(1))));
    const first = runner.say({ step: 0 });
    void first.patches.next();
    runner.say({ step: 0 });
    await sleep(10);
    expect(first.log.entries.some((e) => e.kind === 'abort')).toBe(true);
  });
});

describe('turn: boundary validation', () => {
  it('drops a patch the injected validator rejects, and logs why', async () => {
    const turn = startTurn(
      { step: 0 },
      deps(oneNodeGraph(emitter(3)), {
        validate: (p: Patch) => (patchLabel(p) === 'patch 2' ? 'slot "x": malformed Slider value' : null),
      }),
    );
    const got = await drain(turn);
    expect(got).toEqual(['patch 1', 'patch 3']);
    const rejected = turn.log.entries.filter((e) => e.kind === 'patch-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('malformed Slider');
  });

  it('with no validator every patch passes — validation is the contract owner\'s job, not the transport\'s', async () => {
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitter(2))));
    await expect(drain(turn)).resolves.toEqual(['patch 1', 'patch 2']);
  });
});

describe('turn log', () => {
  const dir = join(tmpdir(), `jit-turnlog-${process.pid}`);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes one JSONL line per turn, greppable by turnId, with the decision and every patch', async () => {
    const path = join(dir, 'turns.jsonl');
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitter(3)), { logPath: path }));
    await drain(turn);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    // The grep a human actually runs.
    const mine = lines.filter((l) => l.includes(turn.turnId));
    expect(mine).toHaveLength(1);

    const record = JSON.parse(mine[0] as string) as {
      turnId: string;
      outcome: string;
      entries: { kind: string; patch?: ContentPatch }[];
    };
    expect(record.turnId).toBe(turn.turnId);
    expect(record.outcome).toBe('ok');
    // A turn that finished is not a turn that aborted. If every line carried
    // an `abort` entry the log could not answer the question it exists for.
    expect(record.entries.some((e) => e.kind === 'abort')).toBe(false);
    expect(record.entries.filter((e) => e.kind === 'patch')).toHaveLength(3);
    expect(record.entries.some((e) => e.kind === 'turn-start')).toBe(true);
    expect(record.entries.some((e) => e.kind === 'node')).toBe(true);
    expect(record.entries.at(-1)?.kind).toBe('turn-end');
  });

  it('flushes in the finally — a crashed turn is still a line in the file', async () => {
    const path = join(dir, 'crash.jsonl');
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitThenThrow(2, 0)), { logPath: path }));
    await drain(turn, 150);

    const record = JSON.parse(readFileSync(path, 'utf8').trim()) as {
      entries: { kind: string }[];
    };
    expect(record.entries.filter((e) => e.kind === 'patch')).toHaveLength(2);
    expect(record.entries.some((e) => e.kind === 'fault')).toBe(true);
  });

  it('flushes on an abort too', async () => {
    const path = join(dir, 'abort.jsonl');
    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitter(4, 10)), { logPath: path }));
    for await (const p of turn.patches) {
      void p;
      turn.abort();
    }
    const record = JSON.parse(readFileSync(path, 'utf8').trim()) as { outcome: string };
    expect(record.outcome).toBe('aborted');
  });

  it('two turns append two greppable lines, each carrying only its own patches', async () => {
    const path = join(dir, 'two.jsonl');
    const runner = createTurnRunner(deps(oneNodeGraph(emitter(2)), { logPath: path }));
    const a = runner.say({ step: 0 });
    await drain(a);
    const b = runner.say({ step: 0 });
    await drain(b);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.includes(a.turnId))).toHaveLength(1);
    expect(lines.filter((l) => l.includes(b.turnId))).toHaveLength(1);
    for (const line of lines) {
      const record = JSON.parse(line) as { outcome: string; entries: { kind: string }[] };
      expect(record.outcome).toBe('ok');
      expect(record.entries.filter((e) => e.kind === 'patch')).toHaveLength(2);
    }
  });
});
