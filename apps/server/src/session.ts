import type { JsonObject, TemplateId } from '@jit/schema';
import { findDeviations, type TaskState } from './domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from './domain/recipes.js';
import { CONTACTS } from './seed.js';

/**
 * What the device knows about this conversation.
 *
 * It used to be the recipe and nothing else, which is why it answered
 * everything with the recipe: the only context a generated surface ever
 * received was `task=Classic Chocolate Chip...`, so being told someone's name
 * came back as "Welcome to the recipe, let's make cookies". A device that is
 * spoken to has to remember being spoken to.
 *
 * Deliberately NOT graph state: LangGraph state is per-invocation, and the
 * whole point is that the next utterance knows about the last one.
 */
export type Exchange = {
  /** What was said. */
  said: string;
  /** What the device put on screen in reply, if anything. */
  showed: TemplateId | null;
};

export type Session = {
  task: TaskState;
  currentTemplate: TemplateId | null;
  /** Contacts picked on `people_picker`, in the order they were chosen. */
  chosen: readonly string[];
  /** Who the device is talking to, once they have said so. */
  name?: string;
  /** The conversation so far, oldest first. */
  history: readonly Exchange[];
};

/**
 * How much conversation is carried into a prompt.
 *
 * Enough that "what did I just ask?" works, bounded because every exchange is
 * input tokens on every later turn — an unbounded transcript makes the last
 * utterance of a long session cost the most and slowest.
 */
const REMEMBERED = 8;

export const createSession = (now = Date.now()): Session => ({
  task: { recipe: CLASSIC_CHOCOLATE_CHIP, scale: 1, stepIndex: 0, inBowl: {}, stepStartedAt: now },
  currentTemplate: null,
  chosen: [],
  history: [],
});

/**
 * Picks a name out of an introduction.
 *
 * Deterministic, because it is a fact the user stated rather than a judgment:
 * extracting it in TypeScript costs nothing, cannot hallucinate a different
 * name, and is available on the SAME turn it was said — a model-extracted
 * name would arrive a turn late, which is exactly when it is most wanted.
 */
export function extractName(utterance: string): string | null {
  const match = /\b(?:my name is|i am|i'm|im|call me|this is)\s+([a-z][a-z'-]{1,20})\b/i.exec(utterance);
  const raw = match?.[1];
  if (!raw) return null;
  // "I'm done", "I'm making cookies" — a verb or a state, not an introduction.
  const notNames = new Set(['done', 'making', 'baking', 'cooking', 'trying', 'going', 'ready', 'here', 'back', 'good', 'ok', 'okay', 'sure', 'not', 'sorry', 'looking', 'thinking', 'hungry', 'finished']);
  if (notNames.has(raw.toLowerCase())) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Records an exchange, keeping the transcript bounded. */
export function remember(session: Session, said: string, showed: TemplateId | null): void {
  const name = extractName(said);
  if (name) session.name = name;
  session.history = [...session.history, { said, showed }].slice(-REMEMBERED);
}

/** One line describing the task, for a prompt or for Jev's `taskState`. */
export function describeTask(session: Session): string {
  const { task } = session;
  const step = task.recipe.steps[task.stepIndex];
  const deviations = findDeviations(task);
  return [
    `recipe=${task.recipe.name}`,
    `scale=${task.scale}`,
    `step=${task.stepIndex + 1}/${task.recipe.steps.length}${step ? ` (${step.instruction})` : ''}`,
    deviations.length > 0 ? `offPlan=${deviations.map((d) => `${d.name}x${d.factor}`).join(',')}` : 'onPlan',
  ].join(' ');
}

/**
 * What a generated surface is told about the conversation.
 *
 * The keys are named for what they ARE rather than what to do with them —
 * `onScreen` is not an instruction to talk about the recipe, and labelling it
 * as background is what stops a greeting being answered with a cookie pitch.
 */
export function contextFor(session: Session, options: { social?: boolean } = {}): JsonObject {
  const chosen = session.chosen
    .map((id) => CONTACTS.find((c) => c.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return {
    ...(session.name ? { personTalkingToYou: session.name } : {}),
    // A greeting gets no task context at all. Telling the model not to
    // mention the recipe while handing it the recipe is a fight it loses:
    // "hello" came back as "let's make some delicious cookies".
    ...(options.social ? {} : { onScreenBackground: describeTask(session) }),
    ...(chosen.length > 0 ? { peopleTheyChose: chosen.join(', ') } : {}),
    earlierInThisConversation: session.history.map((h) => h.said).slice(-5),
  };
}
