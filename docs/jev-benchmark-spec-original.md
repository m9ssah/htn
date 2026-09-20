# Jev replacement benchmark — original specification

Verbatim as requested, 2026-09-19. Kept so that the adaptations in
[`jev-benchmark-plan.md`](./jev-benchmark-plan.md) have a referent: that document
says what changed and why, and this one is what it changed *from*.

> Note added after measurement: this spec assumes Jev is a fast general-purpose LLM.
> It is a typed judgment model with three primitives and no generative output, so
> sections requiring generation (Skeleton/UI Generation, Information Gathering,
> styling-value production) are not expressible against it. See
> [`jev-findings-v1.md`](./jev-findings-v1.md) §0.

---

Create a comprehensive technical testing plan for evaluating the ability of "Jev," a low-latency LLM, to replace different nodes in our multi-agent architecture without materially reducing response quality.

## CONTEXT

Our agent architecture starts with:

```
User Request
→ Agent A: Task Assignment
→ Multiple specialized agent nodes
→ Execution / UI / Functional Actions
```

The major nodes we want to evaluate include:

1. Task Assignment
2. Information / Research Gathering
3. Research Strategy — deciding WHAT information should be researched
4. LLM Gain Context — deciding what information should be passed to the execution model
5. Component Decision — deciding which UI component should be used
6. Skeleton / UI Generation
7. Styling / Component Modification
8. Functional Action
9. Settings Update
10. Task Decomposition / To-do Generation

The overall goal is NOT simply to determine whether Jev can answer questions correctly.

We want to determine:

- Which individual nodes can be replaced by Jev
- How complex a task Jev can handle at each node
- Where Jev starts to degrade in quality
- Which nodes are fundamentally difficult for Jev to replace
- How many nodes can simultaneously be replaced by Jev
- How much latency can be reduced through Jev replacement
- Whether we can maximize Jev usage while maintaining response quality

## CORE RESEARCH QUESTION

"What is the maximum portion of the agent architecture that can be replaced with Jev while maintaining an acceptable level of end-to-end quality?"

The testing should specifically investigate two areas:

**A. Low-cost / relatively easy decision-making** — choosing a UI component, selecting a styling option, choosing between constrained alternatives, simple settings changes, straightforward functional actions.

**B. Abstract decision-making** — deciding what information needs to be researched, deciding whether additional research is necessary, deciding which context is relevant, decomposing a complex task, deciding which agents/nodes should be invoked, resolving ambiguity and conflicting information.

## TESTING METHODOLOGY

Use a two-stage benchmark.

### STAGE 1 — SINGLE-NODE REPLACEMENT

First establish a strong-LLM baseline where all relevant reasoning nodes use the stronger model. Then replace ONLY ONE NODE with Jev while keeping everything else identical.

For every node, compare:

```
Baseline:   Strong LLM → Strong LLM → Strong LLM
Treatment:  Strong LLM → Jev        → Strong LLM
```

This isolates whether Jev can perform that specific role.

### STAGE 2 — MULTI-NODE REPLACEMENT

After individual node testing, progressively replace multiple nodes with Jev.

```
C0 — 100% Strong LLM
C1 — One Jev node
C2 — Two Jev nodes
C3 — Local decision nodes replaced with Jev
C4 — Local decisions + context selection replaced with Jev
C5 — Most execution-level nodes replaced with Jev
C6 — Broad Jev deployment
C7 — Jev everywhere
```

The goal is to identify the maximum Jev coverage that maintains the required quality threshold.

## DIFFICULTY LADDER

- **LEVEL 1 — EASY** — One-step decisions with an obvious mapping and little ambiguity.
- **LEVEL 2 — MEDIUM** — Requires understanding several contextual constraints.
- **LEVEL 3 — HARD** — Requires multiple constraints, dependencies, or tradeoffs.
- **LEVEL 4 — AMBIGUOUS** — Multiple solutions are defensible and the model must make a judgment based on requirements.
- **LEVEL 5 — MULTI-STEP** — Requires decomposition, planning, and coordination between multiple nodes.

The benchmark should identify the point where Jev's performance begins to materially degrade.

## TEST FAMILY 1 — UI COMPONENT DECISION

Goal: determine whether Jev can reliably make inexpensive UI decisions.

1. "The user needs to choose one option from five mutually exclusive options. Which UI component should we use?"
2. "The user needs to turn notifications on or off. Which component should we use?"
3. "The user needs to select one country from 200 countries. Which component should we use?"
4. "The user can select multiple interests from a list of 20 interests. Which component should we use?"
5. "The user needs to compare Free, Pro, and Enterprise plans. What UI pattern should be used?"

Increase complexity by adding constraints such as: mobile responsiveness, accessibility, long descriptions, large numbers of options, existing design-system constraints, multiple interaction requirements.

Evaluate: requirement understanding, component appropriateness, constraint satisfaction, downstream implementation success.

Do NOT require an exact answer when multiple UI solutions are valid.

## TEST FAMILY 2 — STYLING DECISION

Goal: determine whether Jev can make low-cost styling decisions.

Test: color changes, typography, spacing, layout, responsive behavior, existing design-system consistency, component variants, visual hierarchy. Progressively introduce constraints.

- **EASY:** "Change this button from blue to green."
- **MEDIUM:** "Make this button more prominent while maintaining the existing design system."
- **HARD:** "Make the primary CTA more prominent without increasing its visual weight too much or disrupting the existing hierarchy."
- **AMBIGUOUS:** "Make the page feel more modern and easier to scan."

Measure whether Jev understands the actual design requirement rather than simply producing a plausible styling change.

## TEST FAMILY 3 — RESEARCH STRATEGY

This is one of the MOST IMPORTANT benchmark categories.

Do not simply test whether Jev can perform research. Test whether Jev can determine WHAT research should be performed.

Example — User: "I want to add dark mode to my application." Ask Jev: "Before implementing this, what information should you investigate?"

Expected categories may include: existing theme architecture, current color tokens, existing dark-mode support, theme persistence, system preference support, settings architecture, design-system constraints.

Test progressively harder cases.

**RESEARCH PRIORITIZATION** — Give Jev a large list of possible information: analytics, existing UI, competitor implementations, user feedback, accessibility requirements, backend architecture, branding, payment provider, browser support, database schema, existing design system. Ask: "Which information should you investigate first, and why?"

Evaluate: relevance, prioritization, missing critical information, unnecessary research, ability to explain dependencies.

**RESEARCH STOPPING CONDITION** — Test whether Jev knows when it has enough information. Example: "You have identified three possible implementation approaches and have enough information to distinguish their main tradeoffs. Do you need more research before making the decision?"

Measure: whether Jev continues unnecessary research, whether Jev stops too early, whether Jev identifies genuinely missing information. This is particularly important because unnecessary research directly increases latency.

## TEST FAMILY 4 — INFORMATION GATHERING

Separate "deciding what to research" from "performing the research."

- **Easy:** Find one known piece of information.
- **Medium:** Gather several pieces of relevant information.
- **Hard:** Gather information from multiple sources.
- **Ambiguous:** Determine which information is actually relevant.
- **Adversarial:** Provide conflicting or outdated information.

Measure: completeness, relevance, source quality, conflict detection, recency awareness, downstream usefulness.

## TEST FAMILY 5 — LLM GAIN CONTEXT / CONTEXT SELECTION

Test whether Jev can determine what information should be passed to the execution model.

Provide Jev with a large pool of information containing relevant information, irrelevant information, distractors, redundant information, conflicting information.

Example — User request: "Add a dark mode toggle to Settings."

Available information:

1. Application uses React
2. Application uses Tailwind
3. User lives in Canada
4. Theme is stored in localStorage
5. Existing settings page has 12 controls
6. System theme detection is supported
7. Company logo is blue
8. User joined two years ago
9. Design system uses semantic color tokens
10. Current theme implementation exists

Ask Jev: "What information should be passed to the execution agent?"

Measure: context precision, context recall, irrelevant-context rate, missing-critical-context rate, context compression, downstream execution success.

Increase candidate information from 10 → 20 → 30 → 50+ items.

## TEST FAMILY 6 — TASK ASSIGNMENT

Test whether Agent A can correctly determine which nodes should be invoked.

- **Easy:** "Change the button color." → Expected: styling / component modification.
- **Medium:** "Create a settings page where users can change notification preferences." → Expected to identify relevant research, UI, and functional actions.
- **Hard:** "Build a dashboard showing the company's most important metrics that automatically updates every minute." → Potential requirements: determine metrics, determine data source, research existing architecture, design UI, implement data fetching, implement refresh behavior, handle loading/error states.

Evaluate: correct routing, missing nodes, unnecessary nodes, correct ordering, dependency awareness.

## TEST FAMILY 7 — TASK DECOMPOSITION

Test whether Jev can convert a high-level request into executable tasks.

Example: "Build a profile settings page where users can change their name, profile picture, password, and notification preferences."

Evaluate whether Jev identifies: required research, UI structure, functional actions, dependencies, validation, error states, final verification.

Test increasingly complex dependency graphs.

Measure: missing-step rate, unnecessary-step rate, dependency errors, ordering errors, downstream success.

## TEST FAMILY 8 — FUNCTIONAL ACTION

Separate deciding what action should happen from actually executing it.

1. "Turn notifications off."
2. "Disable push notifications but keep email notifications enabled."
3. "Disable notifications until tomorrow."
4. "Disable push notifications, preserve email notifications, and show a confirmation."

Evaluate: correct action, correct parameters, correct state, correct sequencing, error recovery, downstream consequences.

## TEST FAMILY 9 — SETTINGS UPDATE

Test constrained state changes: toggle a setting, change one setting without touching another, update multiple related settings, apply temporary settings, handle conflicting instructions.

The model should be penalized for modifying state that the user did not request.

## EVALUATION RUBRIC

Score each test using a 0–4 scale:

- **4** — Fully correct and robust
- **3** — Correct with a minor issue that does not affect the outcome
- **2** — Partially correct; downstream correction required
- **1** — Materially incorrect but potentially recoverable
- **0** — Failed task / invalid action

Also record **END-TO-END SUCCESS**: 0 = failed, 1 = successful.

Do NOT rely on one aggregate score alone. Track the individual dimensions separately.

### PRIMARY METRICS

1. **Node Decision Correctness** — Did the node make the correct decision?
2. **End-to-End Task Success** — Did the overall agent produce the desired result?
3. **Quality Gap** — Difference between Jev and the strong-LLM baseline.
4. **Latency** — Node inference latency, research/tool latency, total workflow latency.
5. **Cost** — Input tokens, output tokens, total token usage, estimated cost.

### SECONDARY METRICS

Recovery rate, unnecessary research rate, missing-context rate, irrelevant-context rate, invalid-action rate, missing-step rate, over-decomposition rate, dependency error rate, cascading failure rate.

## LATENCY ANALYSIS

For every node compare strong LLM latency vs Jev latency.

```
Latency Reduction = (Strong LLM latency − Jev latency) / Strong LLM latency
```

But do not optimize latency independently from quality. The key metric is: **"Quality maintained per unit of latency reduction."**

## SINGLE-NODE REPLACEMENT MATRIX

Create a result table with: Node | Jev Pass Rate | Quality Gap | Latency Reduction | Cost Reduction | Recovery Rate | Failure Mode | Maximum Complexity

Nodes: Task Assignment, Research Strategy, Information Gathering, Context Selection, Component Decision, Skeleton/UI Generation, Styling, Functional Action, Settings Update, Task Decomposition.

## MULTI-NODE EXPERIMENT

After testing individual nodes, progressively combine Jev nodes.

```
Configuration 0: All Strong LLM
Configuration 1: Component Decision = Jev
Configuration 2: Component Decision + Styling = Jev
Configuration 3: Component Decision + Styling + Context Selection = Jev
Configuration 4: Local decisions + Information Gathering = Jev
Configuration 5: Most execution-level nodes = Jev
Configuration 6: Almost all nodes = Jev
Configuration 7: All nodes = Jev
```

Measure the complete workflow after every configuration.

## FAILURE TAXONOMY

Classify every Jev failure as one of:

1. Wrong routing
2. Missing research
3. Unnecessary research
4. Poor research prioritization
5. Irrelevant context
6. Missing critical context
7. Wrong component
8. Wrong styling decision
9. Wrong functional action
10. Incorrect parameters
11. Missing dependency
12. Incorrect task ordering
13. Over-decomposition
14. Unsupported assumption
15. Failure to resolve ambiguity
16. Failure to recognize uncertainty
17. Cascading downstream failure

This allows us to identify not just THAT Jev failed, but WHY.

## HYBRID / ESCALATION TEST

Finally, test a hybrid architecture.

Jev handles: simple decisions, low-risk local decisions, straightforward routing, simple context selection, constrained actions.

Escalate to the stronger model when: the task is highly ambiguous, multiple conflicting constraints exist, research is required, dependencies are complex, the action is high-impact, Jev detects uncertainty, the task exceeds a defined complexity threshold.

Test whether selective escalation can preserve quality while retaining most of Jev's latency advantage.

## FINAL OUTPUT

The benchmark should produce a "Jev Replacement Map":

Node → Replaceable by Jev? → Maximum tested complexity → Quality impact → Latency reduction → Cost reduction → Common failure modes → Escalation trigger

The final result should identify four categories:

1. Robustly replaceable nodes
2. Conditionally replaceable nodes
3. Nodes requiring stronger reasoning
4. Nodes that should trigger escalation when complexity increases

## MOST IMPORTANT QUESTION

The final experiment should answer: **"How many nodes in our agent architecture can be replaced with Jev before we observe a meaningful degradation in end-to-end response quality?"**

The goal is to maximize Jev coverage and latency reduction while maintaining the predefined quality threshold, rather than simply maximizing the number of Jev nodes.
