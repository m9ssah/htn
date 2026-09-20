import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { TemplateId } from '@jit/schema';
import { applyDeviation, findDeviations, type TaskState } from './domain/recipe.js';
import { applyCommand, resolveCommand } from './domain/commands.js';
import { DEVIATION_FACTORS } from './harness/clients/jev-questions.js';
import { CONTACTS } from './seed.js';
import { stubMediaFinder, type MediaFinder } from './harness/clients/media.js';
import { stubPolishSource, type PolishSource } from './harness/clients/polish.js';
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
  /**
   * `null` means KEEP, and it is passed through rather than collapsed to the
   * current template.
   *
   * Collapsing it made every keep-command repaint the surface it was keeping.
   * On a generated surface that was fatal: the repaint emits a skeleton whose
   * slots are all pending, and an action turn carries no utterance — so the
   * content model was asked to fill it with an empty intent, produced nothing
   * usable, and the surface shimmered for ever. Pressing the button on an
   * answer was a one-way trip into a loading screen.
   */
  return { template: outcome.template, note: outcome.note };
}
import { composeGenerated, composeProjected, isGeneratedSurface, isProjectedSurface } from './compose/projected.js';
import { runGuarded, runtimeOf, type TurnRuntime } from './harness/graph-runtime.js';
import { decide } from './harness/nodes.js';
import { generate } from './harness/nodes/generate.js';
import { policy } from './harness/nodes/policy.js';
import { project } from './harness/nodes/project.js';
import { style } from './harness/nodes/style.js';
import { polish } from './harness/nodes/polish.js';
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
/**
 * The surface budget, from what the device reported.
 *
 * `enforceHeight` is on whenever the device has told us its size: the budget
 * is measured against something real at that point, and two-column layouts
 * gave it enough room to fold gracefully rather than gut a surface.
 */
function panelOf(session: Session): { maxWidth?: number; maxHeight?: number; enforceHeight?: boolean } {
  const panel = session.panel;
  if (!panel) return {};
  return {
    maxWidth: Math.max(320, panel.width - 40),
    // What the stage keeps once the rail has taken its row.
    maxHeight: Math.max(160, panel.height - 72),
    enforceHeight: true,
  };
}

/** Fills in what the last remembered exchange actually put on screen. */
function noteShown(session: Session, templateId: TemplateId): void {
  const last = session.history.at(-1);
  if (last && last.showed === null) {
    session.history = [...session.history.slice(0, -1), { ...last, showed: templateId }];
  }
}

/**
 * Asking to SEE something, as opposed to asking about it.
 *
 * Needs a visual word: "show me the ingredients" wants the list, not a
 * photograph of it.
 */
const WANTS_MEDIA = /\b(look(s)? like|picture|photo|image|video|clip|footage|show me how|see it|watch)\b/i;

/** Whether "show me" means this step, or the dish as a whole. */
const wantsStepMedia = (said: string): boolean => /\b(this|that|step|doing|now)\b/i.test(said);

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
  /**
   * What `paint` actually put up, and in what shape — read by `style` and
   * `polish`, which run after it. `templateId` alone is not enough: it is
   * what was DECIDED, and paint's own guards (social, recovery-suppression)
   * can and do change it before anything reaches the screen.
   */
  painted: Annotation<{ templateId: TemplateId; layout?: string } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

type State = typeof GraphState.State;

export type GraphDeps = { media: MediaFinder; polish: PolishSource };

export function createGraph(
  session: Session,
  deps: GraphDeps = { media: stubMediaFinder, polish: stubPolishSource },
): PatchStream {
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
        // A command that keeps the surface has nothing to paint. Repainting
        // anyway is how a press became an endless shimmer.
        if (!template) return { halted: true };
        return { templateId: template, commanded: true };
      }

      /**
       * "Show me" is a request to SEE, and it resolves here.
       *
       * Routed through the model it came back `refine`, and `refine_keep`
       * discarded the template — correctly, by p18's rule that a refine must
       * never swap the surface. But asking for a picture is not refining the
       * one you are on. It is a finite, visual intent, so it is matched in
       * TypeScript and skips the round trip entirely.
       *
       * Deliberately narrow: "show me the ingredients" is a request for the
       * ingredients, not for a photograph of them.
       */
      if (WANTS_MEDIA.test(state.utterance ?? '')) {
        turn.note('command', { utterance: state.utterance, action: 'show_me', source: 'spoken' });
        return { templateId: 'show_me' as TemplateId, commanded: true };
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
        if (!template) return { halted: true };
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
      /**
       * "Show me what that looks like" — a real lookup, not a stub.
       *
       * Deterministic routing, because the subject is already known: the step
       * being followed, or the recipe. Asking the router first would cost a
       * round trip to reach a surface whose content comes from somewhere else
       * entirely.
       */
      if (templateId === 'show_me') {
        const step = session.task.recipe.steps[session.task.stepIndex];
        const subject = wantsStepMedia(state.utterance ?? '') && step
          ? step.instruction
          : session.task.recipe.name;
        const requestId = `${turn.turnId}-surface`;
        const cached = session.media?.subject === subject ? session.media : null;
        const found = cached ? cached.hit : await deps.media.find(subject, turn.ctx.signal).catch(() => null);
        if (!cached) session.media = { subject, hit: found };
        turn.note('media', { subject, cached: Boolean(cached), found: found ? `${found.kind}: ${found.url}` : 'nothing' });

        const composed = composeProjected(
          {
            kind: 'show_me',
            subject,
            media: found,
            caption: found
              ? `From Wikimedia Commons — ${found.kind === 'video' ? 'a clip' : 'a picture'} of ${subject.toLowerCase()}.`
              : 'Nothing matched that on Wikimedia Commons.',
          },
          { requestId, generationId: `${turn.turnId}-gen`, ...panelOf(session) },
        );
        if (!composed.ok) {
          turn.note('paint-failed', { templateId, reason: composed.reason });
          return { halted: true };
        }
        turn.ctx.sink.emit(composed.structure);
        turn.ctx.sink.emit(composed.content);
        session.currentTemplate = 'show_me';
        noteShown(session, 'show_me');
        return { painted: { templateId: 'show_me' as TemplateId } };
      }

      if (isGeneratedSurface(templateId)) {
        const requestId = `${turn.turnId}-surface`;
        const generationId = `${turn.turnId}-gen`;

        /**
         * The SHAPE of the answer, chosen per turn.
         *
         * Without this every unscripted question painted one fixed
         * composition and only the words differed — the device read as a
         * chatbot because structurally it was one. `message_drafts` has a
         * shape the task already determines, so only `generic_answer` varies.
         */
        const layout = templateId === 'generic_answer' ? state.jev?.layout?.value : undefined;

        /**
         * `media_led` is the one archetype that cannot be composed from the
         * utterance alone, so its picture is fetched BEFORE the skeleton is
         * built: a Media box whose `src` arrives later would either paint
         * empty or reflow when it landed, and the reservation rule exists to
         * prevent exactly that.
         */
        let media: { url: string; kind: 'video' | 'image' } | null = null;
        if (layout === 'media_led') {
          const subject = state.utterance?.trim() || session.task.recipe.name;
          const cached = session.media?.subject === subject ? session.media : null;
          media = cached ? cached.hit : await deps.media.find(subject, turn.ctx.signal).catch(() => null);
          if (!cached) session.media = { subject, hit: media };
          turn.note('media', { subject, layout, found: media ? `${media.kind}: ${media.url}` : 'nothing' });
        }

        if (layout) turn.note('layout', { templateId, layout, confidence: state.jev?.layout?.confidence });

        const composed = composeGenerated(
          templateId,
          { requestId, generationId, ...panelOf(session) },
          { ...(layout ? { layout } : {}), media },
        );
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
        return { painted: { templateId, ...(layout ? { layout } : {}) } };
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
          ...panelOf(session),
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
      return { painted: { templateId } };
    })

    /**
     * Last, and gated on `wantsStyleChange`: p14 measured Jev picks a theme on
     * every utterance, so an ungated restyle would repaint surfaces nobody
     * asked to change.
     */
    .addNode('style', async (state: State, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      const generated = state.painted ? isGeneratedSurface(state.painted.templateId) : false;
      const result = await runGuarded(style, { jev: state.jev!, generated }, turn, 'node-crashed');
      if (result.ok && result.out) turn.ctx.sink.emit(result.out);
      return {};
    })

    /**
     * Agent 4. Raw tokens, contrast-checked, emitted last.
     *
     * Last because it is the slowest and the least essential: the surface has
     * already painted, filled and taken its enum theme by the time this call
     * returns, so a slow or failing designer costs a restyle rather than a
     * screen. Nothing downstream waits on it.
     *
     * Generated surfaces only, for the same reason `style` is ungated only
     * for them — an answer is new and deserves its own look; a recipe in
     * progress does not get repainted underneath the person following it.
     */
    .addNode('polish', async (state: State, config: LangGraphRunnableConfig) => {
      const turn = runtimeOf(config);
      const painted = state.painted;
      if (!painted || !isGeneratedSurface(painted.templateId)) return {};

      const jev = state.jev!;
      const theme = {
        palette: jev.theme.palette.value,
        fontPairing: jev.theme.fontPairing.value,
        density: jev.theme.density.value,
        radius: jev.theme.radius.value,
        motif: jev.theme.motif.value,
      };
      const brief = {
        utterance: state.utterance ?? '',
        templateId: painted.templateId,
        ...(painted.layout ? { layout: painted.layout } : {}),
        base: theme,
      };

      // The designer's own failures are caught here rather than thrown: a
      // styling pass must never take down a turn whose surface is already on
      // screen and readable.
      const raw = await deps.polish.design(brief, turn.ctx.signal).catch((err: unknown) => {
        turn.note('polish-failed', { reason: String(err) });
        return null;
      });
      if (raw === null) return {};

      const result = await runGuarded(polish, { brief, theme, raw }, turn, 'node-crashed');
      if (!result.ok) return {};

      if (!result.out.ok) {
        // Loud, per constraint 5 and the contrast policy: a rejected patch
        // keeps a structured report rather than disappearing.
        turn.note('polish-rejected', { reason: result.out.reason, failures: result.out.failures });
        return {};
      }

      turn.note('polish', {
        interpretedAs: result.out.patch.interpretedAs,
        axes: Object.keys(result.out.patch.tokens).length,
      });
      turn.ctx.sink.emit(result.out.patch);
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
    .addEdge('style', 'polish')
    .addEdge('polish', END)
    .compile();

  return graph as unknown as PatchStream;
}
