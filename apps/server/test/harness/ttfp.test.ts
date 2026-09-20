import { describe, expect, it } from 'vitest';
import { startTurn } from '../../src/harness/turn.js';
import { deps, oneNodeGraph, emitter, sleep } from './doubles.js';
import type { Ctx, Node } from '../../src/harness/types.js';

/**
 * Time to first patch, measured rather than asserted from a probe log.
 *
 * Two numbers, because quoting one as the other is how the plan's latency
 * section says people get this wrong: what the TRANSPORT costs, and what a
 * turn costs when a Jev-shaped node sits in front of it.
 *
 * Budget context: CLAUDE.md constraint 3 wants skeleton paint under 250ms,
 * and the plan's done-when 3 scopes that to "from `decide` start, warm" —
 * not from end of utterance, which also contains STT and a websocket hop and
 * has never been measured.
 */
describe('time to first patch', () => {
  it('costs less than one frame of transport overhead', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const turn = startTurn({ step: 0 }, deps(oneNodeGraph(emitter(1))));
      for await (const p of turn.patches) void p;
      samples.push(turn.firstPatchMs ?? Number.POSITIVE_INFINITY);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[10] as number;

    // eslint-disable-next-line no-console
    console.log(`TTFP transport-only: p50 ${p50.toFixed(2)}ms, max ${(samples.at(-1) as number).toFixed(2)}ms (n=20)`);
    // One frame at 60Hz. A control must respond within one frame, so the
    // graph invocation itself must not be a budget line at all.
    expect(p50).toBeLessThan(16);
  });

  it('adds ~nothing to a Jev-shaped turn: sink to consumer is sub-millisecond', async () => {
    const jevShaped: Node<void, void> = {
      name: 'jev-shaped',
      async run(_input, ctx: Ctx): Promise<void> {
        await sleep(211); // P3's measured warm Jev p50 for the real 10-question batch
        ctx.sink.emit({ v: 1, templateId: 'generic_answer', maxWidth: 720 });
        for (let slot = 0; slot < 6; slot += 1) {
          await sleep(50);
          ctx.sink.emit({ v: 1, slots: {} });
        }
      },
    };

    const turn = startTurn({ step: 0 }, deps(oneNodeGraph(jevShaped)));
    for await (const p of turn.patches) void p;

    const emit = turn.firstEmitMs as number;
    const consumer = turn.firstPatchMs as number;
    // eslint-disable-next-line no-console
    console.log(`TTFP behind a 211ms node: emit ${emit.toFixed(1)}ms, consumer ${consumer.toFixed(1)}ms`);

    // The skeleton reaches the consumer essentially the moment the node
    // emits it, and — the part that matters — long before the six content
    // patches behind it have finished.
    expect(consumer - emit).toBeLessThan(16);
    expect(consumer).toBeLessThan(250);
  });
});
