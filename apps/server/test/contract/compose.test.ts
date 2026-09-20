import { describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { experimental_composeSpec, type Experimental_ChoiceQuestion, type Experimental_CompositionCandidate, type Experimental_CompositionEvaluator } from '@json-render/core';
import { JIT_CATALOG, createJsonRenderer } from '@jit/renderer';
import type { SurfaceSpec } from '@jit/schema';
import { COMPOSE_DEADLINE_MS, fixtureComposer, jevStructureComposer, rebindComposedSpec, type ComposeEvent, type JevCandidate } from '../../src/contract/compose.js';
import { contentUpdateFrom, deriveContentRequest, validateContentResult } from '../../src/contract/content.js';

const bind = (id: string, field: string) => ({ $state: `/content/${id}/${field}` });

/**
 * Candidate id, `props.id` and content segment are all DIFFERENT on purpose.
 * `STUDY_SESSION_EXAMPLE` hand-picks element ids equal to their state-path
 * segment, so a test built on it cannot see the binding bug at all.
 */
const CANDIDATES: JevCandidate[] = [
  { id: 'shell', description: 'The one surface.', root: true, element: { type: 'Card', props: {} } },
  { id: 'flow', description: 'A vertical flow.', root: false, element: { type: 'Stack', props: {} } },
  { id: 'lede', description: 'The headline.', root: false, element: { type: 'Heading', props: { id: 'headline-slot', pending: bind('headline', 'pending'), text: bind('headline', 'text'), level: 1 } } },
  { id: 'note', description: 'One supporting line.', root: false, element: { type: 'Text', props: { id: 'note-slot', pending: bind('supporting', 'pending'), text: bind('supporting', 'text'), tone: 'muted' } } },
];

const INITIAL_STATE = {
  content: {
    headline: { pending: true, text: '' },
    supporting: { pending: true, text: '' },
  },
};

/** Deterministic stand-in for Jev: picks a legal answer for every question. */
function scripted(pick: (name: string, question: Experimental_ChoiceQuestion) => string, delayMs = 0): Experimental_CompositionEvaluator {
  return async ({ questions, signal }) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    signal.throwIfAborted();
    return {
      answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => [name, { choice: pick(name, question), confidence: 0.9 }])),
      usage: { inputTokens: 1200 },
    };
  };
}

function chooseAll(name: string, question: Experimental_ChoiceQuestion): string {
  const keys = Object.keys(question.criteria);
  if (name === 'root') return 'shell';
  if (name.startsWith('select_')) return keys.find((key) => key.startsWith('use:')) ?? keys[0]!;
  if (name.startsWith('order_')) {
    const position = name.slice('order_node_'.length);
    return keys.includes(position) ? position : keys[0]!;
  }
  return keys[0]!;
}

async function drain(events: AsyncIterable<ComposeEvent>): Promise<ComposeEvent[]> {
  const seen: ComposeEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const INPUT = { intent: 'Explain one thing.', requestId: 'compose-test', generationId: 'gen-1' };
const live = (): AbortSignal => new AbortController().signal;

describe('structure composition', () => {
  it('composes elements under library-assigned keys that the candidates never mention', async () => {
    // The defect, reproduced against the unmodified library: the element
    // lands as `node_N` while its binding still names the candidate's own
    // content segment, so no `values[elementId][field]` write can reach it.
    let raw: SurfaceSpec | null = null;
    for await (const event of experimental_composeSpec({
      catalog: JIT_CATALOG,
      candidates: CANDIDATES as readonly Experimental_CompositionCandidate[],
      prompt: INPUT.intent,
      initialState: INITIAL_STATE,
      evaluate: scripted(chooseAll),
      signal: live(),
    })) if (event.type === 'complete') raw = event.spec as SurfaceSpec;

    const heading = Object.entries(raw!.elements).find(([, element]) => element.type === 'Heading')!;
    expect(heading[0]).toMatch(/^node_\d+$/);
    expect(heading[1].props.text).toEqual({ $state: '/content/headline/text' });
    expect(heading[1].props.id).toBe('headline-slot');

    const { request, unresolved } = deriveContentRequest({ requestId: 'x', locale: 'en-CA', intent: INPUT.intent, context: {}, spec: raw! });
    expect(request.targets).toEqual([]);
    expect(unresolved.map((entry) => entry.prop)).toEqual(['text', 'text']);
  });

  it('rebinds every content path, id and state key onto the assigned element key', async () => {
    const composer = jevStructureComposer({ evaluate: scripted(chooseAll), candidates: CANDIDATES, initialState: INITIAL_STATE });
    const events = await drain(composer.compose(INPUT, live()));
    const last = events.at(-1)!;
    expect(last.kind).toBe('structure');
    if (last.kind !== 'structure') throw new Error('unreachable');
    expect(last.update.status).toBe('complete');
    expect(last.completion).toMatchObject({ stopReason: 'finish', inputTokens: 2400, steps: 2 });

    const spec = last.update.spec;
    const { request, unresolved } = deriveContentRequest({ requestId: 'x', locale: 'en-CA', intent: INPUT.intent, context: {}, spec });
    expect(unresolved).toEqual([]);
    expect(request.targets.map((target) => target.elementId).sort()).toEqual(Object.entries(spec.elements).filter(([, element]) => element.type === 'Heading' || element.type === 'Text').map(([id]) => id).sort());

    for (const target of request.targets) {
      const element = spec.elements[target.elementId]!;
      expect(element.props.id).toBe(target.elementId);
      for (const field of target.fields) {
        expect(element.props[field.name]).toEqual({ $state: `/content/${target.elementId}/${field.name}` });
      }
      // `pending` moved with it, values and all, so the element still
      // shimmers until this element's content lands.
      expect(element.props.pending).toEqual({ $state: `/content/${target.elementId}/pending` });
      expect((spec.state!.content as Record<string, Record<string, unknown>>)[target.elementId]).toEqual({ pending: true, text: '' });
    }
    expect(Object.keys(spec.state!.content as object).sort()).toEqual(request.targets.map((target) => target.elementId).sort());
  });

  it('paints generated content into a composed surface and clears every shimmer', async () => {
    // The whole path, offline: compose -> rebind -> derive -> validate ->
    // emit -> the real renderer. Nothing here shares an id with a candidate,
    // so it fails outright if the rebinding is wrong.
    const composer = jevStructureComposer({ evaluate: scripted(chooseAll), candidates: CANDIDATES, initialState: INITIAL_STATE });
    const events = await drain(composer.compose(INPUT, live()));
    const last = events.at(-1)!;
    if (last.kind !== 'structure') throw new Error('expected a structure event');

    const { request } = deriveContentRequest({ requestId: INPUT.requestId, locale: 'en-CA', intent: INPUT.intent, context: {}, spec: last.update.spec });
    const values = Object.fromEntries(request.targets.map((target) => [target.elementId, { [target.fields[0]!.name]: `copy for ${target.elementId}` }]));
    const validation = validateContentResult(request, { contract: 'jit.content.result.v1', requestId: request.requestId, catalogVersion: request.catalogVersion, values });
    expect(validation.rejected).toEqual([]);

    const host = document.createElement('div');
    const renderer = createJsonRenderer(host);
    flushSync(() => {
      expect(renderer.apply(last.update)).toEqual({ ok: true });
      expect(renderer.apply(contentUpdateFrom(request, validation, { generationId: INPUT.generationId }))).toEqual({ ok: true });
    });

    expect(request.targets).toHaveLength(2);
    for (const target of request.targets) {
      expect(target.elementId).toMatch(/^node_\d+$/);
      expect(host.querySelector(`[data-slot="${target.elementId}"]`)?.textContent).toBe(`copy for ${target.elementId}`);
    }
    expect(host.querySelectorAll('[data-shimmer]')).toHaveLength(0);
    renderer.destroy();
  });

  it('copies a shared content segment per element rather than moving it', () => {
    const rebound = rebindComposedSpec({
      root: 'node_0',
      elements: {
        node_0: { type: 'Card', props: {}, children: ['node_1', 'node_2'] },
        node_1: { type: 'Heading', props: { id: 'a', text: bind('shared', 'text') } },
        node_2: { type: 'Text', props: { id: 'b', text: { $bindState: '/content/shared/text' } } },
      },
      state: { content: { shared: { text: 'seed' } } },
    });
    expect(rebound.elements.node_1!.props.text).toEqual({ $state: '/content/node_1/text' });
    expect(rebound.elements.node_2!.props.text).toEqual({ $bindState: '/content/node_2/text' });
    expect(rebound.state!.content).toEqual({ node_1: { text: 'seed' }, node_2: { text: 'seed' } });
  });

  it('surfaces `unavailable` as a typed outcome instead of painting nothing', async () => {
    const composer = jevStructureComposer({ evaluate: scripted((name, question) => (name === 'root' ? 'unavailable' : chooseAll(name, question))), candidates: CANDIDATES, initialState: INITIAL_STATE });
    const events = await drain(composer.compose(INPUT, live()));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('unavailable');
    expect(events[0]!.completion).toMatchObject({ stopReason: 'unavailable', inputTokens: 1200 });
  });

  it('reports a truncated composition as complete, not as still in flight', async () => {
    const composer = jevStructureComposer({ evaluate: scripted(chooseAll), candidates: CANDIDATES, initialState: INITIAL_STATE, maxElements: 1 });
    const events = await drain(composer.compose(INPUT, live()));
    const last = events.at(-1)!;
    if (last.kind !== 'structure') throw new Error('expected a structure event');
    expect(last.completion?.stopReason).toBe('limit');
    expect(last.update.status).toBe('complete');
  });

  it('refuses a candidate that would be placed more than once', () => {
    expect(() => jevStructureComposer({
      evaluate: scripted(chooseAll),
      candidates: [...CANDIDATES, { id: 'spacer', description: 'A repeated row.', maxUses: 3, element: { type: 'Row', props: {} } }],
      initialState: INITIAL_STATE,
    })).toThrow('maxUses > 1');
  });

  it('replays a fixture through the same seam, and still respects barge-in', async () => {
    const update = { v: 2, stage: 'structure', requestId: 'r', generationId: 'g', maxWidth: 640, status: 'complete', spec: { root: 'card', elements: { card: { type: 'Card', props: {} } } } } as const;
    const composer = fixtureComposer(update);
    expect(await drain(composer.compose(INPUT, live()))).toEqual([{ kind: 'structure', update, completion: { stopReason: 'finish', inputTokens: 0, elapsedMs: 0, steps: 0 } }]);
    const aborted = new AbortController();
    aborted.abort(new Error('barge-in'));
    await expect(drain(composer.compose(INPUT, aborted.signal))).rejects.toThrow('barge-in');
  });

  it('cancels on the caller signal and on its own deadline', async () => {
    const composer = jevStructureComposer({ evaluate: scripted(chooseAll), candidates: CANDIDATES, initialState: INITIAL_STATE });
    const aborted = new AbortController();
    aborted.abort(new Error('barge-in'));
    await expect(drain(composer.compose(INPUT, aborted.signal))).rejects.toThrow('barge-in');

    const midFlight = new AbortController();
    const cancelling = jevStructureComposer({
      evaluate: async (request) => { midFlight.abort(new Error('barge-in mid-call')); return scripted(chooseAll)(request); },
      candidates: CANDIDATES,
      initialState: INITIAL_STATE,
    });
    await expect(drain(cancelling.compose(INPUT, midFlight.signal))).rejects.toThrow('barge-in mid-call');

    const slow = jevStructureComposer({ evaluate: scripted(chooseAll, 40), candidates: CANDIDATES, initialState: INITIAL_STATE, timeoutMs: 5 });
    await expect(drain(slow.compose(INPUT, live()))).rejects.toThrow(/timed out|aborted/i);
    expect(COMPOSE_DEADLINE_MS).toBe(3000);
  });
});
