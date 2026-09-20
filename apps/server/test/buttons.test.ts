import { describe, expect, it } from 'vitest';
import type { TemplateId } from '@jit/schema';
import { composeGenerated, composeProjected, isGeneratedSurface, type ProjectedInput } from '../src/compose/projected.js';
import { createSession, type Session } from '../src/session.js';
import { runCommand } from '../src/graph.js';
import { CHOICE_OPTIONS, CONTACTS } from '../src/seed.js';

/**
 * Every button on every surface, pressed.
 *
 * Reported from the device: clicking sometimes did what you expected and
 * sometimes jumped to an unrelated frame. A press can only ever do what the
 * surface implies it does, so this walks the actions each surface actually
 * declares and asserts where each one leaves you — rather than trusting that
 * the command table and the templates still agree.
 */

const ids = { requestId: 'r', generationId: 'g' };

const fresh = (): Session => createSession();

/** The actions a surface really declares, read off the composed spec. */
function actionsOf(kind: TemplateId, session: Session): string[] {
  const result = isGeneratedSurface(kind)
    ? composeGenerated(kind, ids)
    : composeProjected(inputFor(kind, session), ids);
  if (!result.ok) throw new Error(`${kind} did not compose: ${result.reason}`);
  return Object.values(result.structure.spec.elements)
    .flatMap((el) => Object.values(el.on ?? {}).map((binding) => binding.action))
    .filter((a): a is string => typeof a === 'string');
}

function inputFor(kind: TemplateId, session: Session): ProjectedInput {
  if (kind === 'choice_cards') return { kind: 'choice_cards', options: CHOICE_OPTIONS };
  if (kind === 'people_picker') return { kind: 'people_picker', contacts: CONTACTS, chosen: session.chosen };
  return { kind, state: session.task } as ProjectedInput;
}

const SURFACES: TemplateId[] = ['choice_cards', 'item_detail', 'focus_step', 'summary_done', 'people_picker', 'generic_answer', 'message_drafts'];

describe('every declared action does something defined', () => {
  it.each(SURFACES)('%s: no action is unknown to the command table', (kind) => {
    const session = fresh();
    for (const action of actionsOf(kind, session)) {
      const { note } = runCommand(fresh(), action);
      expect(note, `${kind} declares "${action}" but nothing handles it`).not.toContain('no command named');
    }
  });
});

describe('a press goes where the surface implies', () => {
  it('choice_cards: picking the demo recipe opens its detail', () => {
    const s = fresh();
    const { template } = runCommand(s, 'select_classic_choc_chip');
    expect(template).toBe('item_detail');
  });

  it('item_detail: starting begins at step one', () => {
    const s = fresh();
    const { template } = runCommand(s, 'begin');
    expect(template).toBe('focus_step');
    expect(s.task.stepIndex).toBe(0);
  });

  it('focus_step: next advances, back returns', () => {
    const s = fresh();
    runCommand(s, 'begin');
    runCommand(s, 'next_step');
    expect(s.task.stepIndex).toBe(1);
    runCommand(s, 'prev_step');
    expect(s.task.stepIndex).toBe(0);
  });

  it('summary_done: sharing opens the picker', () => {
    const s = fresh();
    expect(runCommand(s, 'share').template).toBe('people_picker');
  });

  it('people_picker: confirming with nobody chosen stays put rather than advancing', () => {
    const s = fresh();
    runCommand(s, 'share');
    expect(runCommand(s, 'write_messages').template).toBe('people_picker');
  });

  /**
   * The reported jump: "Got it" on an answer used to drop you into the
   * recipe, which is a frame change nobody asked for.
   */
  /**
   * `null` means "keep", and keeping must mean NOT repainting.
   *
   * Repainting a generated surface re-emits a skeleton of pending slots, and
   * an action turn carries no utterance to fill it with — so pressing the
   * button on an answer left it shimmering for ever.
   */
  it('generic_answer: acknowledging repaints nothing and stays put', () => {
    const s = fresh();
    s.currentTemplate = 'generic_answer';

    const { template } = runCommand(s, 'acknowledge');

    expect(template, 'null means keep — do not repaint').toBeNull();
    expect(s.currentTemplate).toBe('generic_answer');
    expect(s.task.stepIndex).toBe(0);
  });

  it('message_drafts: picking a draft stays on the drafts', () => {
    const s = fresh();
    s.currentTemplate = 'message_drafts';

    expect(runCommand(s, 'pick_draft_1').template).toBeNull();
    expect(s.currentTemplate).toBe('message_drafts');
  });

  it('a slider is a display axis, not a navigation', () => {
    const s = fresh();
    s.currentTemplate = 'choice_cards';

    expect(runCommand(s, 'set_preference').template).toBeNull();
    expect(s.currentTemplate).toBe('choice_cards');
  });

  it('an unknown action changes nothing and says so', () => {
    const s = fresh();
    s.currentTemplate = 'focus_step';

    const { template, note } = runCommand(s, 'definitely_not_a_real_action');

    expect(template).toBeNull();
    expect(s.currentTemplate).toBe('focus_step');
    expect(note).toContain('no command named');
  });
});
