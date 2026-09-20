import { describe, expect, it } from 'vitest';
import { contextFor, createSession, extractName, remember } from '../src/session.js';

describe('extractName', () => {
  it.each([
    ['my name is Massah', 'Massah'],
    ["i'm Ari", 'Ari'],
    ['I am Blake', 'Blake'],
    ['call me Cass', 'Cass'],
    ['hi there my name is massah', 'Massah'],
    ['this is Sam', 'Sam'],
  ])('reads a name out of %j', (said, expected) => {
    expect(extractName(said)).toBe(expected);
  });

  /**
   * "I'm" introduces a state far more often than a name, and a device that
   * decided the user was called "Done" would then greet them by it for the
   * rest of the session.
   */
  it.each(['i\'m done', 'im making cookies', 'i am ready', 'i\'m not sure'])(
    'does not mistake %j for an introduction',
    (said) => {
      expect(extractName(said)).toBeNull();
    },
  );

  it('returns null when nobody introduced themselves', () => {
    expect(extractName('what temperature do i bake at')).toBeNull();
  });
});

describe('session memory', () => {
  it('remembers the name from the utterance that carried it', () => {
    const s = createSession();

    remember(s, 'my name is Massah', null);

    expect(s.name).toBe('Massah');
  });

  it('keeps the transcript bounded so a long session does not grow its own prompt forever', () => {
    const s = createSession();

    for (let i = 0; i < 20; i += 1) remember(s, `utterance ${i}`, null);

    expect(s.history.length).toBeLessThanOrEqual(8);
    expect(s.history.at(-1)?.said).toBe('utterance 19');
  });

  it('carries what was said into the context a generated surface receives', () => {
    const s = createSession();
    remember(s, 'my name is Massah', null);
    remember(s, 'what temperature do i bake at', 'generic_answer');

    const context = contextFor(s);

    expect(context.personTalkingToYou).toBe('Massah');
    expect(String(JSON.stringify(context.earlierInThisConversation))).toContain('temperature');
  });

  /**
   * Telling the model not to mention the recipe while handing it the recipe
   * is a fight it loses: "hello" came back as "let's make some cookies".
   */
  it('gives a social turn no task context at all', () => {
    const s = createSession();
    remember(s, 'hi there', null);

    const social = contextFor(s, { social: true });
    const ordinary = contextFor(s);

    expect(social.onScreenBackground).toBeUndefined();
    expect(ordinary.onScreenBackground).toBeDefined();
  });
});
