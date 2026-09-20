import { describe, expect, it } from 'vitest';
import type { SurfaceUpdate } from '@jit/schema';
import { createGraph, createSession, type Session } from '../src/graph.js';
import { startTurn, type TurnDeps } from '../src/harness/turn.js';
import { stubContentSource } from '../src/harness/clients/content.js';
import { stubContentModel } from '../src/harness/clients/content-model.js';
import { stubResearchClient } from '../src/harness/clients/research.js';
import { stubJevClient } from '../src/harness/clients/jev.js';
import type { JevAnswer, JevClient, Route } from '../src/harness/types.js';
import type { TemplateId } from '@jit/schema';

const choice = <T extends string>(value: T) => ({ value, confidence: 0.9, distribution: { [value]: 0.9 } as Partial<Record<T, number>> });

function answer(route: Route, templateId: TemplateId, wantsStyleChange = false): JevAnswer {
  return {
    route: choice(route),
    templateId: choice(templateId),
    theme: {
      palette: choice('rose' as const),
      fontPairing: choice('editorial' as const),
      density: choice('normal' as const),
      radius: choice('soft' as const),
      motif: choice('none' as const),
    },
    wantsStyleChange: { value: wantsStyleChange, probability: wantsStyleChange ? 0.9 : 0.1, confidence: 0.8 },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

const jevReturning = (a: JevAnswer): JevClient => ({ async ask(): Promise<JevAnswer> { return a; } });

const jevFailing = (err: Error): JevClient => ({ async ask(): Promise<JevAnswer> { throw err; } });

function deps(session: Session, jev: JevClient): TurnDeps {
  return { graph: createGraph(session), jev, content: stubContentSource, contentModel: stubContentModel, fetch: stubResearchClient, logPath: null };
}

async function run(session: Session, jev: JevClient, utterance = 'show me the recipe'): Promise<{ patches: SurfaceUpdate[]; log: ReturnType<typeof startTurn>['log'] }> {
  const turn = startTurn({ utterance }, deps(session, jev));
  const patches: SurfaceUpdate[] = [];
  for await (const patch of turn.patches) patches.push(patch);
  return { patches, log: turn.log };
}

describe('the concrete graph', () => {
  it('paints a projected surface: structure first, then content', async () => {
    const session = createSession();

    const { patches } = await run(session, jevReturning(answer('new_task', 'item_detail')));

    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(patches[0]).toMatchObject({ stage: 'structure' });
    expect(patches[1]).toMatchObject({ stage: 'content' });
  });

  it('remembers the surface across turns, which is what makes a follow-up work', async () => {
    const session = createSession();

    await run(session, jevReturning(answer('new_task', 'item_detail')));

    expect(session.currentTemplate).toBe('item_detail');
  });

  /**
   * The property `runGuarded`'s doc warns about: a failure converts to a
   * value, so without routing every later node runs on state that was never
   * produced and files its own fault for one failure.
   */
  it('halts the whole turn when decide fails, rather than running policy/paint/style on nothing', async () => {
    const session = createSession();

    const { patches, log } = await run(session, jevFailing(new Error('jev exploded')));

    expect(patches).toEqual([]);
    const halts = log.entries.filter((e) => e.kind === 'halted');
    expect(halts).toHaveLength(1);
    expect(halts[0]).toMatchObject({ after: 'decide' });
    // One fault for one failure — not four.
    expect(log.entries.filter((e) => e.kind === 'fault')).toHaveLength(1);
  });

  it('keeps the current surface on a decide failure instead of blanking it', async () => {
    const session = createSession();
    await run(session, jevReturning(answer('new_task', 'item_detail')));

    await run(session, jevFailing(new Error('jev timed out')));

    expect(session.currentTemplate).toBe('item_detail');
  });

  it('emits a style patch only when the utterance asked to restyle', async () => {
    const quiet = await run(createSession(), jevReturning(answer('new_task', 'item_detail', false)));
    const loud = await run(createSession(), jevReturning(answer('new_task', 'item_detail', true)));

    expect(quiet.patches.some((p) => 'theme' in p)).toBe(false);
    expect(loud.patches.some((p) => 'theme' in p)).toBe(true);
  });

  it('names a generated template it cannot paint instead of painting something else', async () => {
    const session = createSession();

    const { patches, log } = await run(session, jevReturning(answer('query', 'generic_answer')));

    expect(patches.filter((p) => 'spec' in p)).toEqual([]);
    expect(log.entries.some((e) => e.kind === 'paint-skipped')).toBe(true);
    // The surface it could not paint must not become the remembered one.
    expect(session.currentTemplate).toBeNull();
  });

  it('a style ask still lands when the template itself could not be painted', async () => {
    const { patches } = await run(createSession(), jevReturning(answer('query', 'generic_answer', true)));

    expect(patches.some((p) => 'theme' in p)).toBe(true);
  });

  it('runs end to end on the stub Jev without throwing', async () => {
    const { log } = await run(createSession(), stubJevClient);

    expect(log.entries.some((e) => e.kind === 'turn-end')).toBe(true);
  });
});
