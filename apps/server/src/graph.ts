import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { TemplateId } from '@jit/schema';
import { findDeviations, type TaskState } from './domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from './domain/recipes.js';
import { isProjectedSurface } from './compose/projected.js';
import { runGuarded, runtimeOf, type TurnRuntime } from './harness/graph-runtime.js';
import { decide } from './harness/nodes.js';
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
 * What survives between turns. The device is one session on one screen, so
 * this is a single mutable object rather than a store — but it is explicitly
 * NOT graph state: LangGraph state is per-invocation, and "actually it was
 * three times" only works if the bowl is still there on the next utterance.
 */
export type Session = {
  task: TaskState;
  currentTemplate: TemplateId | null;
};

export const createSession = (now = Date.now()): Session => ({
  task: { recipe: CLASSIC_CHOCOLATE_CHIP, scale: 1, stepIndex: 0, inBowl: {}, stepStartedAt: now },
  currentTemplate: null,
});

/**
 * What Jev is told about the task, as one line.
 *
 * p18 measured that route is unanswerable from the utterance alone — "the
 * second one" and "actually it was three times" are only classifiable against
 * what is already on screen — so this is a real input, not decoration.
 */
function describeTask(session: Session): string {
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

const GraphState = Annotation.Root({
  utterance: Annotation<string>,
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
      const templateId = state.templateId!;
      const jev = state.jev!;

      if (!isProjectedSurface(templateId)) {
        // generic_answer/message_drafts compose their structure rather than
        // projecting it. Reported by name instead of painting something else,
        // which would be a fallback that hides the gap.
        turn.note('paint-skipped', { templateId, reason: 'generated surface — composer not wired' });
        return { halted: true };
      }

      const requestId = `${turn.turnId}-surface`;
      const deviation = jev.deviationIngredient && jev.deviationFactor
        ? { ingredientId: jev.deviationIngredient.value, factor: jev.deviationFactor.value }
        : undefined;

      const result = await runGuarded(
        project,
        {
          state: session.task,
          templateId,
          requestId,
          generationId: `${turn.turnId}-gen`,
          ...(deviation ? { deviation } : {}),
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
    .addConditionalEdges('decide', (state: State) => (state.halted ? END : 'policy'), [END, 'policy'])
    .addConditionalEdges('policy', (state: State) => (state.halted ? END : 'paint'), [END, 'paint'])
    // `style` still runs when `paint` halted on a GENERATED template: the
    // route was understood and a style ask is independent of whether this
    // layer can paint that surface.
    .addConditionalEdges('paint', (state: State) => (state.jev ? 'style' : END), [END, 'style'])
    .addEdge('style', END)
    .compile();

  return graph as unknown as PatchStream;
}
