import { describe, expect, it } from 'vitest';
import type { SurfaceSpec } from '@jit/schema';
import { generate, type GenerateInput } from '../../../src/harness/nodes/generate.js';
import { createStubCtx } from '../../../src/harness/ctx.js';
import type { ContentModel, Ctx } from '../../../src/harness/types.js';

const contentPath = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

const SPEC: SurfaceSpec = {
  root: 'surface',
  elements: {
    surface: { type: 'Card', props: {} },
    title: { type: 'Heading', props: { id: 'title', text: contentPath('title', 'text'), level: 1 } },
    note: { type: 'Text', props: { id: 'note', text: contentPath('note', 'text'), tone: 'muted' } },
  },
};

const INPUT: GenerateInput = {
  requestId: 'req-1',
  generationId: 'gen-1',
  locale: 'en-CA',
  intent: 'Show the selected recipe',
  context: {},
  spec: SPEC,
};

/** A model that answers with exactly `values`, under the request's own envelope. */
function modelReturning(values: Record<string, Record<string, unknown>>): ContentModel {
  return {
    async fill(request): Promise<unknown> {
      return { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values };
    },
  };
}

function ctxWith(contentModel: ContentModel): Ctx {
  return { ...createStubCtx(new AbortController().signal), contentModel };
}

describe('generate', () => {
  it('fills every target the spec binds and emits one content update', async () => {
    const ctx = ctxWith(modelReturning({ title: { text: 'Chocolate Chip' }, note: { text: 'Twelve minutes.' } }));

    const result = await generate.run(INPUT, ctx);

    expect(result.warnings).toEqual([]);
    expect(result.content?.values).toEqual({ title: { text: 'Chocolate Chip' }, note: { text: 'Twelve minutes.' } });
    expect(result.content?.generationId).toBe('gen-1');
  });

  it('resolves an element the model got wrong instead of leaving it shimmering', async () => {
    // `title` exceeds Heading's 48-char maxLength, so it is rejected.
    const ctx = ctxWith(modelReturning({ title: { text: 'x'.repeat(120) }, note: { text: 'Fine.' } }));

    const result = await generate.run(INPUT, ctx);

    expect(result.warnings.join(' ')).toContain('maxLength');
    // Field-less entry: `applyContent` clears pending, so it shows its
    // placeholder rather than shimmering for ever.
    expect(result.content?.values.title).toEqual({});
    expect(result.content?.values.note).toEqual({ text: 'Fine.' });
  });

  it('reports a model failure and paints nothing rather than inventing copy', async () => {
    const failing: ContentModel = {
      async fill(): Promise<unknown> {
        throw new Error('cold start');
      },
    };
    const ctx = ctxWith(failing);

    const result = await generate.run(INPUT, ctx);

    expect(result.content).toBeNull();
    expect(result.warnings.join(' ')).toContain('cold start');
  });

  it('rejects a result belonging to another request whole — nothing in it is trustworthy', async () => {
    const wrongEnvelope: ContentModel = {
      async fill(): Promise<unknown> {
        return { contract: 'jit.content.result.v1', requestId: 'someone-else', catalogVersion: 'jit-device.v2', values: { title: { text: 'No' } } };
      },
    };
    const ctx = ctxWith(wrongEnvelope);

    const result = await generate.run(INPUT, ctx);

    expect(result.content).toBeNull();
    expect(result.warnings.join(' ')).toContain('does not belong to this request');
  });

  it('a surface with no generated prose is a real outcome, not a model call', async () => {
    let called = false;
    const spy: ContentModel = {
      async fill(): Promise<unknown> {
        called = true;
        return {};
      },
    };
    const projected: SurfaceSpec = { root: 'surface', elements: { surface: { type: 'Card', props: {} } } };
    const ctx = ctxWith(spy);

    const result = await generate.run({ ...INPUT, spec: projected }, ctx);

    expect(called).toBe(false);
    expect(result.content).toBeNull();
  });

  it('stays total when the model is slow and the turn aborts', async () => {
    const controller = new AbortController();
    const hanging: ContentModel = {
      async fill(_request, signal): Promise<unknown> {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    };
    const ctx: Ctx = { ...createStubCtx(controller.signal), contentModel: hanging };

    const pending = generate.run(INPUT, ctx);
    controller.abort(new Error('barge-in'));
    const result = await pending;

    expect(result.content).toBeNull();
    expect(result.warnings.join(' ')).toContain('barge-in');
  });
});
