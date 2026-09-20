import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { TemplateId } from '@jit/schema';
import { applyDeviation, findDeviations, type TaskState } from './domain/recipe.js';
import { applyCommand, resolveCommand } from './domain/commands.js';
import { DEVIATION_FACTORS } from './harness/clients/jev-questions.js';
import { CONTACTS } from './seed.js';
import { contextFor, createSession, describeTask, remember, type Session } from './session.js';

export { createSession, type Session } from './session.js';

/**
 * Applies a command to the session and reports where it leaves the user.
 *
 * Shared by the spoken fast path and the device's `action` frames, so a button
 * press and "what's next" cannot drift into meaning different things.
 */
export function runCommand(session: Session, action: string, value?: string | number | boolean): { template: TemplateId | null; note: string } {
  const outcome = applyCommand({ action, task: session.task, chosen: session.chosen, ...(value !== undefined ? { value } : {}) });
  session.task = outcome.task;
  session.chosen = outcome.chosen;
  if (outcome.template) session.currentTemplate = outcome.template;
  return { template: outcome.template ?? session.currentTemplate, note: outcome.note };
}
import { composeGenerated, isGeneratedSurface, isProjectedSurface } from './compose/projected.js';
import { runGuarded, runtimeOf, type TurnRuntime } from './harness/graph-runtime.js';
import { decide } from './harness/nodes.js';
import { generate } from './harness/nodes/generate.js';
import { policy } from './harness/nodes/policy.js';
import { project } from './harness/nodes/project.js';
import { style } from './harness/nodes/style.js';
import type { PatchStream } from './harness/turn.js';
import type { JevAnswer } from './harness/types.js';

/**
 * The concrete graph: `decide -> policy -> project -> style`.
 *
 * **Halt routing is the load-bearing part.** `runGuarded` converts a node
 * failure into a value so an exception can never reach the stream controller
 * and discard patches already queued (p19c/p19d). The cost is that the next
 * node runs anyway, on state the failed one never produced — so every node
 * that can fail sets `halted`, and a conditional edge routes to `END`. See
 * `runGuarded`'s own "READ THIS BEFORE WIRING THE CONCRETE GRAPH".
 *
 * Emission order is structure-then-content, because that is what the paint
 * model is: the skeleton reserves every slot's box, and content fills it
 * without moving anything.
 */

/**
 * What the content model is actually being asked to write.
 *
 * For `generic_answer` the utterance IS the intent — it is the question. For
 * `message_drafts` it is not: "send it" says nothing about what the messages
 * should say, and handing that over produced drafts about flour and baking
 * soda, because the only other thing in the prompt was the recipe step. The
 * surface's PURPOSE is the intent; the utterance is just what triggered it.
 */
/** Fills in what the last remembered exchange actually put on screen. */
function noteShown(session: Session, templateId: TemplateId): void {
  const last = session.history.at(-1);
  if (last && last.showed === null) {
    session.history = [...session.history.slice(0, -1), { ...last, showed: templateId }];
  }
}

const SOCIAL = /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening)|how are you|what'?s up|nice to meet you|my name is|i'?m |im |call me |this is |thanks|thank you|bye|goodbye)/i;

function intentFor(templateId: TemplateId, session: Session, utterance: string): string {
  if (templateId === 'generic_answer' && SOCIAL.test(utterance)) {
    /**
     * A greeting is not a prompt for the task.
     *
     * Told someone's name, the device replied "Welcome to the recipe, let's
     * make cookies" — it had the recipe in context and nothing else, so it
     * pitched it. Being spoken to socially deserves a social answer, and the
     * task is not mentioned unless they raise it.
     */
    const who = session.name ? ` Their name is ${session.name}.` : '';
    return `The person said: "${utterance}".${who} Reply to THEM, warmly and in one short line. `
      + `Do not mention the recipe, the current step, or suggest starting anything — they have not asked to. `
      + `Keep any list items to things about them or the conversation, not about cooking.`;
  }
  if (templateId !== 'message_drafts') return utterance;
  const names = session.chosen
    .map((id) => CONTACTS.find((c) => c.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const who = names.length > 0 ? names.join(' and ') : 'a friend';
  /**
   * The lengths are the ROW's, not a preference: a draft's `title` is a
   * ListItem title (42 characters) and its `detail` the second line (56).
   * Asking for 90 produced drafts that were all rejected for length and rows
   * that rendered empty — the constraint has to be in the ask, not just in
   * the schema the model is free to overshoot.
   */
  return `Text messages offering ${who} some of the ${session.task.recipe.name.toLowerCase()} just baked. `
    + `For each draft: "title" is who it is to, at most 20 characters (e.g. "To ${names[0] ?? 'a friend'}"); `
    + `"detail" is the message itself, at most 50 characters, warm and casual, no emoji.`;
}

const GraphState = Annotation.Root({
  utterance: Annotation<string>,
  /** Set when a command already decided the surface, so routing is skipped. */
  commanded: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  /** A control event — a button, a row, the fader. Bypasses routing entirely. */
  action: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  value: Annotation<string | number | boolean | null>({ reducer: (_prev, next) => next, default: () => null }),
  halted: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  jev: Annotation<JevAnswer | null>({ reducer: (_prev, next) => next, default: () => null }),
  templateId: Annotation<TemplateId | null>({ reducer: (_prev, next) => next, default: () => null }),
});

type State = typeof GraphState.State;

export function createGraph(session: Session): PatchStream {
  const graph = new StateGraph(GraphState)
    /**
     * One batched Jev call: route, template, the five style axes and the
     * `correct`-route extras. Failing here is the one fault that must stop
     * the turn outright — every later node reads `jev`.
     */
    .addNode('decide', async (state: State, config: LangGraphRunnableConfig) => {
      const turn: TurnRuntime = runtimeOf(config);

      /**
       * Recorded before anything is decided, so a name given THIS turn is
       * available to THIS turn's answer. Extracting it afterwards would make
       * "my name is Massah" the one utterance that could not be answered by
       * name, which is the only one where it matters.
       */
      if (state.utterance) remember(session, state.utterance, null);

      /**
       * A control event names its action directly, so there is nothing to
       * route: the surface declared it, the user pressed it. No model call,
       * which is also what keeps a slider scrub inside one frame.
       */
      if (state.action) {
        const { template, note } = runCommand(session, state.action, state.value ?? undefined);
        turn.note('command', { action: state.action, note, template, source: 'control' });
        return { templateId: template, commanded: true };
      }

      /**
       * The spoken fast path.
       *
       * "What's next" and "Ari" are selections from what is already on
       * screen, so they resolve here in TypeScript and skip the model
       * entirely — no round trip, and no chance of the router deciding a
       * contact's name was a `correct` about sugar, which is what it did.
       */
      const command = resolveCommand(session.currentTemplate, state.utterance ?? '');
      if (command) {
        const { template, note } = runCommand(session, command);
        turn.note('command', { utterance: state.utterance, action: command, note, template });
        return { templateId: template, commanded: true };
      }

      const result = await runGuarded(
        decide,
        { utterance: state.utterance, currentTemplate: session.currentTemplate, taskState: describeTask(session) },
        turn,
        'decide-degraded',
      );
      if (!result.ok) {
        // Named, not silent: the surface the user already has stays up, and
        // the log says why nothing replaced it (constraint 5).
        turn.note('halted', { after: 'decide', aborted: result.aborted });
        return { halted: true };
      }
      return { jev: result.out.jev };
    })

    /**
     * Pure and total, so it cannot halt. Jev's `templateId` is a suggestion —
     * p18 found it has to be discarded on every `refine`/`correct`/`select`.
     */
    .addNode('policy', async (state: State, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      const jev = state.jev!;

      /**
       * Land a `correct` answer in the bowl BEFORE policy reads it.
       *
       * `policy` only routes to `recovery` when `hasDeviation` is true, and
       * that is computed from `inBowl`. Jev's `deviationIngredient` /
       * `deviationFactor` were previously computed and dropped, so nothing
       * ever wrote to the bowl, `hasDeviation` was permanently false, and
       * "actually I used three times the sugar" kept the current surface
       * instead of opening the recovery beat — the demo's signature moment,
       * silently dead. Found by `npm run probe`, not by a test.
       *
       * The model classifies (which ingredient, which factor label); the
       * arithmetic is `applyDeviation`'s (constraint 2). It assigns
       * `planned x factor` absolutely, so re-applying the same answer is a
       * no-op rather than a compounding error.
       */
      if (jev.route.value === 'correct' && jev.deviationIngredient && jev.deviationFactor) {
        const label = jev.deviationFactor.value;
        const factor = DEVIATION_FACTORS[label];
        if (factor === null || factor === undefined) {
          // "other" carries no number to compute with, and an unknown label is
          // a Jev/table skew. Either way: reported, never guessed at.
          turn.note('deviation-unapplied', { ingredient: jev.deviationIngredient.value, factor: label });
        } else {
          session.task = applyDeviation(session.task, jev.deviationIngredient.value, factor);
          turn.note('deviation-applied', { ingredient: jev.deviationIngredient.value, factor: label });
        }
      }

      const result = await runGuarded(
        policy,
        {
          route: jev.route.value,
          jevTemplateId: jev.templateId.value,
          currentTemplate: session.currentTemplate,
          hasDeviation: findDeviations(session.task).length > 0,
        },
        turn,
        'node-crashed',
      );
      if (!result.ok) {
        turn.note('halted', { after: 'policy', aborted: result.aborted });
        return { halted: true };
      }
      turn.note('policy', { rule: result.out.rule, templateId: result.out.templateId });
      return { templateId: result.out.templateId };
    })

    /**
     * Projection, not generation: the surface is a function of `TaskState`, so
     * the numbers on screen are computed in TypeScript (constraint 2) and the
     * structure budget holds with no model in the path.
     */
    .addNode('paint', async (state: State, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      let templateId = state.templateId!;

      /**
       * A correction screen with nothing to correct is not an answer.
       *
       * `policy` only routes `correct` to `recovery` when the bowl has
       * actually drifted, but `honour_jev` can hand back `recovery` for a
       * `new_task` or `query` — and it did: unrelated speech produced a
       * recovery surface announcing "18 new cookies" over an empty bowl.
       * The guard is here rather than in `policy` because it needs the task
       * state, which `policy` is deliberately kept ignorant of.
       */
      /**
       * Being greeted must never navigate the task.
       *
       * Jev picks a template for every utterance, and for "hi there, my name
       * is Massah" it picked `focus_step` — so saying hello jumped the device
       * into step one of a recipe nobody had asked for. A social utterance can
       * only ever be answered, never acted on.
       */
      if (SOCIAL.test(state.utterance ?? '') && isProjectedSurface(templateId)) {
        turn.note('social-answered', { templateId, reason: 'a greeting is answered, not acted on' });
        templateId = 'generic_answer';
      }

      if (templateId === 'recovery' && findDeviations(session.task).length === 0) {
        const fallback = session.currentTemplate ?? 'item_detail';
        turn.note('recovery-suppressed', { reason: 'nothing in the bowl deviates from the plan', fallback });
        templateId = fallback;
      }

      /**
       * The generated surfaces. Structure paints at once and the copy follows
       * when the content model answers, which is what makes the device
       * respond to something nobody scripted — a projected cookie screen is
       * the wrong answer to "what's the most expensive ingredient".
       */
      if (isGeneratedSurface(templateId)) {
        const requestId = `${turn.turnId}-surface`;
        const generationId = `${turn.turnId}-gen`;
        const composed = composeGenerated(templateId, { requestId, generationId });
        if (!composed.ok) {
          turn.note('paint-failed', { templateId, reason: composed.reason });
          return { halted: true };
        }

        // Skeleton first, at its final dimensions. Nothing blocks this paint.
        turn.ctx.sink.emit(composed.structure);
        session.currentTemplate = templateId;
        noteShown(session, templateId);

        const filled = await runGuarded(
          generate,
          {
            requestId,
            generationId,
            locale: 'en-CA',
            intent: intentFor(templateId, session, state.utterance ?? ''),
            context: contextFor(session, { social: SOCIAL.test(state.utterance ?? '') }),
            spec: composed.structure.spec,
          },
          turn,
          'node-crashed',
        );

        if (!filled.ok) {
          turn.note('halted', { after: 'generate', aborted: filled.aborted });
          return { halted: true };
        }
        for (const warning of filled.out.warnings) turn.note('paint-warning', { warning });
        if (filled.out.content) turn.ctx.sink.emit(filled.out.content);
        return {};
      }

      if (!isProjectedSurface(templateId)) {
        turn.note('paint-skipped', { templateId, reason: 'neither projected nor generated' });
        return { halted: true };
      }

      // No `deviation` passed: `policy` already applied it to the session's
      // task state, and `project` would otherwise apply the same answer a
      // second time to its local copy. Harmless today (the assignment is
      // absolute) but two places owning one correction is how they drift.
      const result = await runGuarded(
        project,
        {
          state: session.task,
          templateId,
          chosen: session.chosen,
          requestId: `${turn.turnId}-surface`,
          generationId: `${turn.turnId}-gen`,
        },
        turn,
        'node-crashed',
      );
      if (!result.ok) {
        turn.note('halted', { after: 'paint', aborted: result.aborted });
        return { halted: true };
      }

      for (const warning of result.out.warnings) turn.note('paint-warning', { warning });
      if (!result.out.structure) {
        turn.note('paint-empty', { templateId });
        return { halted: true };
      }

      // Structure first: it reserves every slot's box at its final size, so
      // the content that follows fills without moving anything.
      turn.ctx.sink.emit(result.out.structure);
      if (result.out.content) turn.ctx.sink.emit(result.out.content);
      session.currentTemplate = templateId;
      noteShown(session, templateId);
      return {};
    })

    /**
     * Last, and gated on `wantsStyleChange`: p14 measured Jev picks a theme on
     * every utterance, so an ungated restyle would repaint surfaces nobody
     * asked to change.
     */
    .addNode('style', async (state: State, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      const result = await runGuarded(style, state.jev!, turn, 'node-crashed');
      if (result.ok && result.out) turn.ctx.sink.emit(result.out);
      return {};
    })

    .addEdge(START, 'decide')
    .addConditionalEdges(
      'decide',
      (state: State) => (state.halted ? END : state.commanded ? 'paint' : 'policy'),
      [END, 'policy', 'paint'],
    )
    .addConditionalEdges('policy', (state: State) => (state.halted ? END : 'paint'), [END, 'paint'])
    // `style` still runs when `paint` halted on a GENERATED template: the
    // route was understood and a style ask is independent of whether this
    // layer can paint that surface.
    .addConditionalEdges('paint', (state: State) => (state.jev ? 'style' : END), [END, 'style'])
    .addEdge('style', END)
    .compile();

  return graph as unknown as PatchStream;
}
