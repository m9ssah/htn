import type { ContentUpdateV2, JsonObject, TemplateId } from '@jit/schema';
import { formatDuration, readTimer } from './domain/timer.js';
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
  /**
   * What the DEVICE says it has room for, once it has told us.
   *
   * Assuming an 800x480 panel was wrong on any Pi running the browser
   * windowed: `.stage` clips rather than scrolls, so 44px of every surface
   * vanished with nothing to indicate it. A surface is budgeted against the
   * space that exists, not the space we hoped for.
   */
  panel?: { width: number; height: number };
  /** Set once a running timer has hit zero, so it stops being re-sent. */
  timerFinishedAt?: number;
  /**
   * The last picture fetched, kept so a repaint does not re-query.
   *
   * Any turn that leaves the media surface up re-composes it, and without
   * this each one was another round trip to Commons for a picture already on
   * screen — and often a DIFFERENT one, so the image changed under someone
   * who had not asked for a new one.
   */
  media?: { subject: string; hit: { url: string; kind: 'video' | 'image' } | null };
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
 * One second of a running timer, as a content patch — or `null` when nothing
 * is counting.
 *
 * Only the timer's own two slots are named, so a tick cannot disturb anything
 * else on the surface, and it stops once the clock hits zero: a finished
 * timer does not need re-sending every second for the rest of the session.
 *
 * Every value is computed here (constraint 2). No model and no graph run on a
 * tick, which is what keeps a clock off the latency budget entirely.
 */
export function tickTimer(session: Session, now = Date.now()): ContentUpdateV2 | null {
  const { task } = session;
  const step = task.recipe.steps[task.stepIndex];
  if (session.currentTemplate !== 'focus_step' || step?.seconds === undefined || task.timerStartedAt === undefined) {
    return null;
  }

  const reading = readTimer({ startedAt: task.timerStartedAt, durationMs: step.seconds * 1000 }, now);
  if (reading.done && session.timerFinishedAt !== undefined) return null;
  if (reading.done) session.timerFinishedAt = now;

  return {
    v: 2,
    stage: 'content',
    requestId: `timer-${task.timerStartedAt}`,
    generationId: `timer-${task.timerStartedAt}`,
    complete: false,
    values: {
      timer_remaining: { label: reading.done ? 'Timer done' : 'Time left', value: formatDuration(reading.remainingMs) },
      timer_bar: { pct: Math.round(reading.pct) },
    },
  };
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
