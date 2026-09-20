import { describe, expect, it } from 'vitest';
import type { ContentPatch } from '@jit/schema';
import { generate } from '../../src/harness/nodes.js';
import { createStubCtx } from '../../src/harness/ctx.js';
import { createMemorySinkStore } from '../../src/harness/clients/sink.js';
import type { ContentSource, Event } from '../../src/harness/types.js';

/**
 * `generate` defines its own wire protocol over the generic `ContentSource`
 * string stream (see `harness/nodes/generate.ts`'s doc): line 1 is a JSON
 * array of not-applicable slot ids, every other line is
 * `{"slot":"...","value":{...}}`. These test doubles speak that protocol
 * directly — no subprocess, no fixture, CI-safe.
 */
function linesSource(lines: string[]): ContentSource {
  return {
    async *stream(): AsyncGenerator<string> {
      for (const line of lines) yield line;
    },
  };
}

describe('generate', () => {
  it('emits one slot per patch into the sink, not batched at node exit', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);
    const lines = [
      '[]',
      '{"slot":"generic_answer.action","value":{"text":"Ok"}}',
      '{"slot":"generic_answer.title","value":{"text":"Title"}}',
      '{"slot":"generic_answer.body","value":{"text":"Body"}}',
      '{"slot":"generic_answer.point1","value":{"title":"One"}}',
    ];
    // Records how many patches the sink already holds right before each line
    // is handed to `generate` — proof of streaming delivery, not just of
    // one-key-per-patch granularity. A node that buffered everything until
    // it returned would record all zeros.
    const sinkSizeBeforeEachLine: number[] = [];
    ctx.content = {
      async *stream(): AsyncGenerator<string> {
        for (const line of lines) {
          sinkSizeBeforeEachLine.push(store.patches.length);
          yield line;
        }
      },
    };

    await generate.run({ templateId: 'generic_answer', utterance: 'what temp for cookies' }, ctx);

    // The Button (line 2) unblocks the hold-back buffer, so title/body/point1
    // are each already in the sink before the next one is even requested.
    expect(sinkSizeBeforeEachLine).toEqual([0, 0, 1, 2, 3]);

    // 4, not 5 — the empty `[]` preamble line contributes zero patches.
    const patches = store.patches as ContentPatch[];
    expect(patches).toHaveLength(4);
    for (const p of patches) expect(Object.keys(p.slots)).toHaveLength(1);
  });

  it('emits not-applicable slots first, as an explicit null, before anything else', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);
    ctx.content = linesSource([
      '["generic_answer.point2","generic_answer.point3"]',
      '{"slot":"generic_answer.action","value":{"text":"Ok"}}',
      '{"slot":"generic_answer.title","value":{"text":"Title"}}',
      '{"slot":"generic_answer.body","value":{"text":"Body"}}',
      '{"slot":"generic_answer.point1","value":{"title":"One"}}',
    ]);

    await generate.run({ templateId: 'generic_answer', utterance: 'x' }, ctx);

    const patches = store.patches as ContentPatch[];
    expect(patches[0]?.slots['generic_answer.point2']).toBeNull();
    expect(patches[1]?.slots['generic_answer.point3']).toBeNull();
    const firstNonNull = patches.findIndex((p) => Object.values(p.slots)[0] !== null);
    expect(firstNonNull).toBe(2); // both nulls landed before any other slot
  });

  it('flushes every Button before any non-Button slot, regardless of source order', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);
    // Deliberately misordered — title/body ahead of the Button, the exact
    // shape of the defect p14 measured (a button label arriving last).
    ctx.content = linesSource([
      '[]',
      '{"slot":"generic_answer.title","value":{"text":"Title"}}',
      '{"slot":"generic_answer.body","value":{"text":"Body"}}',
      '{"slot":"generic_answer.action","value":{"text":"Ok"}}',
      '{"slot":"generic_answer.point1","value":{"title":"One"}}',
      '{"slot":"generic_answer.point2","value":{"title":"Two"}}',
      '{"slot":"generic_answer.point3","value":{"title":"Three"}}',
    ]);

    await generate.run({ templateId: 'generic_answer', utterance: 'x' }, ctx);

    const order = (store.patches as ContentPatch[]).map((p) => Object.keys(p.slots)[0]);
    expect(order[0]).toBe('generic_answer.action');
    expect(order.indexOf('generic_answer.action')).toBeLessThan(order.indexOf('generic_answer.title'));
    expect(order.indexOf('generic_answer.action')).toBeLessThan(order.indexOf('generic_answer.body'));
  });

  it('catches a content-source failure, keeps what already emitted, fault-marks, and returns normally', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);
    const events: Event[] = [];
    ctx.telemetry = (e) => events.push(e);
    ctx.content = {
      async *stream(): AsyncGenerator<string> {
        yield '[]';
        yield '{"slot":"generic_answer.action","value":{"text":"Ok"}}';
        throw new Error('source blew up');
      },
    };

    // The promise resolves — a throwing `generate` at slot 3 would have lost
    // slots 1-2 to controller.error()'s queue reset (p19c/p19d).
    await expect(generate.run({ templateId: 'generic_answer', utterance: 'x' }, ctx)).resolves.toBeUndefined();

    const patches = store.patches as ContentPatch[];
    expect(patches).toHaveLength(1);
    expect(patches[0]?.slots['generic_answer.action']).toEqual({ kind: 'Button', text: 'Ok' });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('generate-fault');
  });

  it('rejects a malformed Slider (missing min) before it reaches the sink', async () => {
    const store = createMemorySinkStore();
    const ctx = createStubCtx(new AbortController().signal, store);
    const events: Event[] = [];
    ctx.telemetry = (e) => events.push(e);
    ctx.content = linesSource([
      '[]',
      '{"slot":"message_drafts.edit","value":{"text":"Edit"}}',
      '{"slot":"message_drafts.send","value":{"text":"Send"}}',
      '{"slot":"message_drafts.tone","value":{"label":"Tone","max":10,"step":1,"value":5}}',
    ]);

    await generate.run({ templateId: 'message_drafts', utterance: 'x' }, ctx);

    const patches = store.patches as ContentPatch[];
    expect(patches.some((p) => 'message_drafts.tone' in p.slots)).toBe(false);
    expect(events.some((e) => e.kind === 'generate-fault')).toBe(true);
    // The two Buttons, which arrived before the malformed Slider, still made it.
    expect(patches.some((p) => 'message_drafts.edit' in p.slots)).toBe(true);
    expect(patches.some((p) => 'message_drafts.send' in p.slots)).toBe(true);
  });
});
