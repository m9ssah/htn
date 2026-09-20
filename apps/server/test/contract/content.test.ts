import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { STUDY_SESSION_EXAMPLE, createJsonRenderer } from '@jit/renderer';
import type { ContentGenerationRequestV1, SurfaceSpec } from '@jit/schema';
import { contentUpdateFrom, deriveContentRequest, validateContentResult } from '../../src/contract/content.js';

const bind = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

/** Three leaves under one surface, so "the middle one" is a real position. */
function threeSlotSpec(): SurfaceSpec {
  return {
    root: 'card',
    elements: {
      card: { type: 'Card', props: {}, children: ['stack'] },
      stack: { type: 'Stack', props: {}, children: ['first', 'middle', 'last'] },
      first: { type: 'Heading', props: { id: 'first', pending: bind('first', 'pending'), text: bind('first', 'text'), level: 1 } },
      middle: { type: 'Text', props: { id: 'middle', pending: bind('middle', 'pending'), text: bind('middle', 'text') } },
      last: { type: 'ListItem', props: { id: 'last', pending: bind('last', 'pending'), title: bind('last', 'title'), hasDetail: false } },
    },
    state: {
      content: {
        first: { pending: true, text: '' },
        middle: { pending: true, text: '' },
        last: { pending: true, title: '' },
      },
    },
  };
}

function requestFor(spec: SurfaceSpec): ContentGenerationRequestV1 {
  const { request, unresolved } = deriveContentRequest({ requestId: 'three-slots', locale: 'en-CA', intent: 'Say three things.', context: {}, spec });
  expect(unresolved).toEqual([]);
  return request;
}

const envelope = (request: ContentGenerationRequestV1, values: Record<string, Record<string, unknown>>) => ({
  contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values,
});

describe('Stage 2 content contract', () => {
  it('derives targets only after Stage 1 has selected the concrete spec', () => {
    const { request, unresolved } = deriveContentRequest({
      requestId: 'study-session-planner',
      locale: 'en-CA',
      intent: STUDY_SESSION_EXAMPLE.intent,
      context: { audience: 'student' },
      spec: STUDY_SESSION_EXAMPLE.structure.spec,
    });

    expect(unresolved).toEqual([]);
    expect(request.targets.map((target) => target.elementId)).toContain('title');
    expect(request.targets.map((target) => target.elementId)).toContain('duration');
    expect(request.targets.map((target) => target.elementId)).not.toContain('stack');
    expect(request.targets.find((target) => target.elementId === 'duration')?.fields.map((field) => field.name)).toEqual(['label']);
  });

  it('keeps bound props out of `fixed`, including $bindState ones', () => {
    const spec = threeSlotSpec();
    spec.elements.first!.props.subtitleish = { $bindState: '/ui/first/draft' };
    const target = requestFor(spec).targets.find((entry) => entry.elementId === 'first')!;
    // `id` and `level` are literals; `pending`, `text` and the $bindState
    // prop are bindings, and a binding is never a fixed value.
    expect(Object.keys(target.fixed)).toEqual(['id', 'level']);
  });

  it('reports a binding no content write can reach instead of silently omitting it', () => {
    const spec = threeSlotSpec();
    // Last segment differs from the prop name, and the element segment names
    // a different element — the two shapes `boundField` used to swallow.
    spec.elements.first!.props.text = bind('first', 'headline');
    spec.elements.middle!.props.text = bind('first', 'text');
    const { request, unresolved } = deriveContentRequest({ requestId: 'three-slots', locale: 'en-CA', intent: 'x', context: {}, spec });
    expect(request.targets.map((target) => target.elementId)).toEqual(['last']);
    expect(unresolved.map((entry) => `${entry.elementId}.${entry.prop}`)).toEqual(['first.text', 'middle.text']);
    expect(unresolved[1]!.reason).toContain("another element's content (first)");
  });

  it('rejects extra targets, fields, and values outside the declared contract', () => {
    const request = requestFor(threeSlotSpec());
    const values = Object.fromEntries(request.targets.map((target) => [target.elementId, Object.fromEntries(target.fields.filter((field) => field.required).map((field) => [field.name, 'valid']))]));

    // Per-element isolation, not a thrown-away surface: an element nobody
    // asked for is dropped, an unrequested field faults only its element.
    const chatty = validateContentResult(request, envelope(request, { ...values, extra: { text: 'no' } }));
    expect(chatty.rejected).toEqual([{ elementId: 'extra', reason: 'Content result returned an unrequested element: extra.' }]);
    expect(Object.keys(chatty.result.values).sort()).toEqual(['first', 'last', 'middle']);

    const surprise = validateContentResult(request, envelope(request, { ...values, first: { text: 'valid', surprise: 'no' } }));
    expect(surprise.rejected).toEqual([{ elementId: 'first', reason: 'Content result returned an unrequested field: first.surprise.' }]);
    expect(Object.keys(surprise.result.values).sort()).toEqual(['last', 'middle']);

    // Envelope failures stay fatal.
    expect(() => validateContentResult(request, envelope(request, values as never)).result).not.toThrow();
    expect(() => validateContentResult(request, { ...envelope(request, values), requestId: 'someone-else' })).toThrow('does not belong to this request');
    expect(() => validateContentResult(request, { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion })).toThrow();
  });

  /**
   * The invariant, verbatim: "Validation failure of one element must not
   * discard the other elements, and the surface must reach a resolved state
   * on every path; never a permanent shimmer."
   */
  it('lands elements 1 and 3 when element 2 of 3 is malformed, and resolves element 2 explicitly', () => {
    const spec = threeSlotSpec();
    const request = requestFor(spec);
    expect(request.targets.map((target) => target.elementId)).toEqual(['first', 'middle', 'last']);

    const validation = validateContentResult(request, envelope(request, {
      first: { text: 'Three things' },
      middle: { text: 42 },
      last: { title: 'The third one' },
    }));

    expect(validation.result.values).toEqual({ first: { text: 'Three things' }, last: { title: 'The third one' } });
    expect(validation.rejected).toEqual([{ elementId: 'middle', reason: 'Expected string at middle.text.' }]);

    // Resolved, not merely omitted: the update names `middle` with no fields,
    // which is what clears its `pending` flag on the device.
    const update = contentUpdateFrom(request, validation, { generationId: 'gen-1' });
    expect(update.values.middle).toEqual({});

    const host = document.createElement('div');
    const renderer = createJsonRenderer(host);
    flushSync(() => {
      expect(renderer.apply({ v: 2, stage: 'structure', requestId: request.requestId, generationId: 'gen-1', maxWidth: 640, status: 'complete', spec })).toEqual({ ok: true });
      expect(renderer.apply(update)).toEqual({ ok: true });
    });

    expect(host.querySelector('[data-slot="first"]')?.textContent).toBe('Three things');
    expect(host.querySelector('[data-slot="last"]')?.textContent).toBe('The third one');
    expect(host.querySelectorAll('[data-shimmer]')).toHaveLength(0);
    renderer.destroy();
  });

  it('ends the turn with every requested element either filled or explicitly resolved', () => {
    const request = requestFor(threeSlotSpec());
    const validation = validateContentResult(request, envelope(request, {
      first: { text: 'Filled' },
      middle: { text: 'x'.repeat(400) },
      // `last` omitted entirely, and one element nobody requested.
      ghost: { text: 'chatty' },
    }));

    const filled = new Set(Object.keys(validation.result.values));
    const resolved = new Set(validation.rejected.map((entry) => entry.elementId));
    for (const target of request.targets) {
      expect(Number(filled.has(target.elementId)) + Number(resolved.has(target.elementId))).toBe(1);
    }
    expect(resolved).toEqual(new Set(['middle', 'last', 'ghost']));

    const update = contentUpdateFrom(request, validation, { generationId: 'gen-2' });
    expect(Object.keys(update.values).sort()).toEqual(['first', 'last', 'middle']);
    expect(update.values.ghost).toBeUndefined();
  });
});
