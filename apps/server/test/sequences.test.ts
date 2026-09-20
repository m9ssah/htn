import { describe, expect, it } from 'vitest';
import type { SurfaceUpdate, TemplateId } from '@jit/schema';
import { createGraph, createSession, runCommand, type Session } from '../src/graph.js';
import { resolveCommand } from '../src/domain/commands.js';
import { startTurn } from '../src/harness/turn.js';
import { stubContentSource } from '../src/harness/clients/content.js';
import { stubContentModel } from '../src/harness/clients/content-model.js';
import { stubResearchClient } from '../src/harness/clients/research.js';
import type { JevAnswer, JevClient, Route } from '../src/harness/types.js';

const choice = <T extends string>(value: T) => ({ value, confidence: 0.9, distribution: { [value]: 0.9 } as Partial<Record<T, number>> });

const jevSaying = (route: Route, templateId: TemplateId): JevClient => ({
  async ask(): Promise<JevAnswer> {
    return {
      route: choice(route),
      templateId: choice(templateId),
      theme: {
        palette: choice('slate' as const), fontPairing: choice('system' as const),
        density: choice('normal' as const), radius: choice('soft' as const), motif: choice('none' as const),
      },
      wantsStyleChange: { value: false, probability: 0.1, confidence: 0.8 },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  },
});

async function turnFor(session: Session, jev: JevClient, utterance: string): Promise<ReturnType<typeof startTurn>> {
  const turn = startTurn({ utterance }, {
    graph: createGraph(session), jev, content: stubContentSource,
    contentModel: stubContentModel, fetch: stubResearchClient, logPath: null,
  });
  const patches: SurfaceUpdate[] = [];
  for await (const p of turn.patches) patches.push(p);
  return turn;
}

describe('the sequences reported broken on the device', () => {
  it('"what\'s next" advances the step instead of repainting the same one', () => {
    const s = createSession();
    runCommand(s, 'begin');
    const before = s.task.stepIndex;

    const action = resolveCommand(s.currentTemplate, "what's next");
    expect(action).toBe('next_step');
    runCommand(s, action!);

    expect(s.task.stepIndex).toBe(before + 1);
  });

  it('a name on the people picker chooses that person', () => {
    const s = createSession();
    runCommand(s, 'share');
    expect(s.currentTemplate).toBe('people_picker');

    const action = resolveCommand(s.currentTemplate, 'Ari');
    expect(action).toBe('choose_ari');
    runCommand(s, action!);

    expect(s.chosen).toEqual(['ari']);
  });

  /**
   * Reported as "saying Ari does nothing": the name toggled, and Ari was
   * already chosen from earlier in the session, so it removed them. Saying
   * someone's name can only ever mean include them.
   */
  it('saying a name twice keeps them chosen rather than removing them', () => {
    const s = createSession();
    runCommand(s, 'share');
    runCommand(s, 'choose_ari');
    runCommand(s, 'choose_ari');

    expect(s.chosen).toEqual(['ari']);
  });

  it('starting a new share forgets the previous run\'s picks', () => {
    const s = createSession();
    runCommand(s, 'share');
    runCommand(s, 'choose_ari');

    runCommand(s, 'share');

    expect(s.chosen).toEqual([]);
  });

  it('choosing people then confirming moves to the drafts', () => {
    const s = createSession();
    runCommand(s, 'share');
    runCommand(s, 'choose_ari');
    runCommand(s, 'choose_blake');
    runCommand(s, 'write_messages');
    expect(s.currentTemplate).toBe('message_drafts');
  });

  /**
   * The reported bug: unrelated speech produced a correction screen
   * announcing "18 new cookies" over a bowl nothing had been added to.
   */
  it('never shows a correction screen when there is nothing to correct', async () => {
    const session = createSession();

    const turn = await turnFor(session, jevSaying('new_task', 'recovery'), 'we have and then just let one agency');

    const suppressed = turn.log.entries.find((e) => e.kind === 'recovery-suppressed');
    expect(suppressed, 'recovery over an unchanged bowl must be suppressed').toBeDefined();
    expect(session.currentTemplate).not.toBe('recovery');
  });

  it('still shows the correction screen once the bowl has actually drifted', async () => {
    const session = createSession();
    session.task = { ...session.task, inBowl: { caster_sugar: 2.25 } };

    const turn = await turnFor(session, jevSaying('new_task', 'recovery'), 'i used too much sugar');

    expect(turn.log.entries.some((e) => e.kind === 'recovery-suppressed')).toBe(false);
    expect(session.currentTemplate).toBe('recovery');
  });

  /**
   * Reported: saying hello jumped the device into step one of a recipe
   * nobody had asked for, because Jev picks a template for every utterance
   * and picked `focus_step` for "hi there, my name is Massah".
   */
  it('a greeting is answered, never acted on', async () => {
    const session = createSession();

    const turn = await turnFor(session, jevSaying('new_task', 'focus_step'), 'hi there my name is massah');

    expect(turn.log.entries.some((e) => e.kind === 'social-answered')).toBe(true);
    expect(session.currentTemplate).toBe('generic_answer');
    // And the greeting still taught it who is talking.
    expect(session.name).toBe('Massah');
  });

  it('an ordinary request is still acted on', async () => {
    const session = createSession();

    const turn = await turnFor(session, jevSaying('new_task', 'focus_step'), 'i want to make cookies');

    expect(turn.log.entries.some((e) => e.kind === 'social-answered')).toBe(false);
    expect(session.currentTemplate).toBe('focus_step');
  });

  it('walking the whole recipe reaches the done screen', () => {
    const s = createSession();
    runCommand(s, 'begin');
    for (let i = 0; i < s.task.recipe.steps.length; i += 1) runCommand(s, 'next_step');
    expect(s.currentTemplate).toBe('summary_done');
  });
});
