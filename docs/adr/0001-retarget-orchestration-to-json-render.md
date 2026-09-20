# 0001 — Retarget the orchestration to the json-render surface contract

- **Status:** accepted
- **Date:** 2026-09-19
- **Deciders:** project owner
- **Supersedes:** the eight-template / slot-ID contract described in `CLAUDE.md`
  under "Architecture" and "New for the device"

## Context

Two workstreams ran in parallel for six hours against the same base commit
(`7049df8`) without exchanging contracts.

The **device workstream** replaced the renderer outright (18 commits, merged to
`origin/main` as `eac0638`). It deleted `packages/renderer/src/{templates,renderer,actions,vocab}.ts`
and with them the `TEMPLATES` export, substituting `catalog.tsx` + `json-renderer.tsx`
built on React 19, `@json-render/*` (vendored preview tarball) and Zod. It added
`packages/schema/src/surface.ts`: `SurfaceSpec`, `StructureUpdateV2`,
`ContentUpdateV2`, and a `ContentGenerationRequest`/`Result` protocol.

The **orchestration workstream** built five phases (`integration` @ `2735259`,
175 tests) against the contract that no longer existed: an enum of eight
templates, `SlotId`-keyed content, and a `templateId` question whose wording had
been tuned through an ablation to 9/9 accuracy.

The divergence was found by reading `git branch -vv` and noticing `main` was
"behind 18", not by any failing build — each side was green in isolation. That
is the first consequence worth recording: **nothing in the tooling made the
divergence visible.**

## Decision

The orchestration retargets to the json-render contract. The device is the
source of truth, because the device is what demos.

The two codebases are **complementary, not competing**. The teammate's
`apps/server/src/orchestration.ts` is named for an orchestrator but is not one:
it exports two pure functions, one interface, two adapters and a type guard. It
contains no turn loop, no `AbortController`, no turn identity, no sink, no
telemetry and no server entry point. The orchestration workstream supplies
exactly those. So:

```
apps/server/src/
  contract/   adopted from the device workstream — owns WHAT the contract is
  harness/    from the orchestration workstream — Node, Ctx, timed, signal
  nodes/      from the orchestration workstream, retargeted to call contract/
  graph.ts    the single orchestrator — owns HOW a turn runs
```

### What survives

The four-patch paint-first model survived the renderer swap intact: the device
still applies `structure → style → content → polish` in order.
`StyleUpdateV1 = StylePatch` and `PolishUpdateV1 = PolishPatch` are the old
types verbatim, so the style axes, the token tables and the contrast policy need
no change at all.

The harness (`Node`/`Ctx`/`timed`/`signal`/sink), the LangGraph wiring, the Jev
HTTP client with its keep-alive agent and budget caps, and the route /
`wantsStyleChange` / deviation questions all carry over unchanged.

### What retires

The `templateId` question and its tuned descriptions, the eight-template enum,
`SlotId`-keyed `ContentPatch` filling, and the hand-written per-kind slot shape
validators — the last replaced by `validateContentResult`, which is stricter.

### Hard constraint 1 is preserved

`CLAUDE.md` constraint 1 requires that Jev return typed values only, and that a
tree be reached by selecting a pre-defined ID rather than by generation. The new
`jevStructureComposer` satisfies this: `experimental_composeSpec` uses Jev as an
*evaluator* over a finite candidate list, choosing which candidate to place. Jev
never emits a tree; the library assembles one from Jev's typed choices. The
constraint holds under a different mechanism, which is why the retarget does not
require amending it.

## Alternatives rejected

**Keep the eight-template contract and ask the device workstream to restore
`TEMPLATES` alongside json-render.** Rejected: zero rework for orchestration,
but it asks a teammate to undo shipped work, leaves two renderers to maintain
with twelve hours remaining, and leaves the device — the thing judges touch —
carrying the cost of a decision made for the server's convenience.

**Run both contracts behind an adapter and decide later.** Rejected: an adapter
between two content models is a third contract to keep correct, and the failure
mode is a surface that renders under test and not on stage. Deferring the choice
buys nothing, because the retarget cost is paid either way.

**Discard the orchestration work and build on the teammate's layer alone.**
Rejected on evidence rather than sentiment: their layer has no turn loop,
cancellation, budget ceiling, telemetry or transport, and three independent
reviews found and fixed real defects in the orchestration harness (a sink that
resurrected dead turns, a budget cap that never bounded failing requests, a
barge-in guarantee that was false). That hardening is the expensive part and it
is contract-independent.

## Consequences

**Negative.**

- The `templateId` ablation — measured, documented, taken from 1/7 to 9/9 — is
  discarded. It is recorded in `docs/orchestration-plan.md` and
  `backend/results/p18c_batched_tdesc.json` as a measurement about question
  wording, which may still inform future Jev prompts.
- `packages/*` now carries React 19, `@json-render/*` and Zod as runtime
  dependencies. `CLAUDE.md` lists "introducing a UI framework or any runtime
  dependency in `packages/*`" under "Ask me before", and the device workstream
  did it without that gate. Recorded as fact, not reopened.
- **`CLAUDE.md` constraint 3's "skeleton under 250ms" is unsatisfiable for
  model-composed surfaces.** A composition costs two sequential evaluator calls
  (measured 211-230ms each against the direct endpoint) plus a gateway hop. The
  owner chose to leave `CLAUDE.md` unamended for now, so this record is the only
  place the conflict is written down. The honest split, for whenever the spec is
  revisited: **projected surfaces <=250ms** (achievable, zero model calls);
  **composed surfaces ~1s target, to be measured rather than asserted.** Do not
  quote the 250ms figure for a composed surface.
- The composer runs outside the orchestration's budget caps and abort
  discipline. It has a bare timeout and no spend ceiling.

**Positive.**

- `validateContentResult` is stricter than the validators it replaces.
- `fixtureComposer` is a deterministic offline seam, so composition can be
  tested without network or spend.
- The `StructureComposer` interface localises any future change of composition
  strategy to one module.

**Defects inherited with the adopted layer.** These were found by review, not by
tests, and are not yet fixed:

0. **The composed path cannot receive content at all.** `composeBatch` assigns
   element keys `node_N` and `structuredClone`s each candidate element without
   rewriting its `$state` paths (vendored `dist/index.js:3629-3637`). So
   `deriveContentRequest` keys a target `node_2` while the element still reads
   `/content/title/text`: content never lands and the shimmer never clears. The
   same mechanism gives any candidate with `maxUses > 1` duplicated `props.id`,
   a shared state path and a shared action — three identical rows firing one
   action. Verified by executing the tarball, not inferred. Invisible to
   `orchestration.test.ts`, whose fixture hand-picks element ids equal to their
   state-path segments.
1. `validateContentResult` throws on the first bad field, so one malformed field
   in one element discards the entire surface's content. The fix is per-element
   isolation: envelope failures stay fatal, element failures isolate, an
   unrequested element is dropped rather than thrown on.
2. `deriveContentRequest`'s `boundField` matches a target by the `$state`
   pointer's last segment and discards the element segment. A pointer whose last
   segment differs from the component's field name silently yields no target —
   an element that shimmers forever — and a pointer to another element's path is
   silently mis-attributed.
3. `$bindState` props are treated as fixed and ship the binding expression as a
   literal value.
4. `Bars` and `Progress` have no `GENERATED_FIELDS` entry and can never receive
   generated content.

## Amendment, same day: the projected composer

Adopted after an architecture review verified the defects above.

A **third `StructureComposer`** is added: `TaskState -> SurfaceSpec`, written in
TypeScript, with **zero model calls**. It emits the same wire contract the device
already accepts, so it sits inside "the device is the source of truth" and uses
the teammate's own seam.

- **Projected surfaces** (recipe/item detail, focus step, recovery, summary done)
  compose deterministically and paint in ~0ms.
- **Composed surfaces** (`generic_answer`, `message_drafts`) keep the Jev
  composer, where open-endedness is the point.
- Jev keeps route, style and deviation classification in both cases.

The argument that settled it is correctness, not latency. `composeBatch` asks a
**per-candidate membership question**, so Jev may legitimately omit any single
candidate — including the "eggs" row of a recipe. **A domain-required element
must not be omittable by a model.** Determinism is the only way to guarantee it.

This does not weaken constraint 6 ("the flow is never hardcoded"): the composer
is a projection of typed domain state, not a scripted flow. It must work for a
recipe nobody scripted — arbitrary ingredient and step counts, a deviation on
any ingredient — and is tested against shapes other than the seed data.

### Rejected in the same amendment

**Placeholder-spec-first** — painting a cheap local spec immediately and letting
the composed one replace it. It was proposed to make paint-first independent of
composer latency, and it does not work: the old skeleton *was* the final
template, so content shimmered inside fixed geometry, whereas a placeholder
replaced by a spec whose shape Jev is still choosing is a reflow by
construction. Two further mechanisms make it worse: the composer's `partial`
yield puts every child flat under root and `complete` reparents them, a visible
reorder; and applying a structure update runs `store.update(stateUpdates(spec))`,
which resets `/content` and wipes anything landed between the two. Decision:
**do not apply `partial` at all** — telemetry only, single paint at `complete`,
and use the shell's existing `thinking` mood to cover the gap.

## Additional silent-failure modes found in the adopted layer

- `getActions()` returns `[]` **silently** when press/toggle/text actions exceed
  4 or ranges exceed 1 (`json-renderer.tsx`, two bare `return []`). The button
  rail goes dark with no telemetry and no reason. Candidate pools and projected
  surfaces must bound interactive elements at build time.
- `stopReason: 'unavailable'` — which Jev returns whenever capabilities cannot
  fulfil the request — yields a `complete` event with `spec: null`, and the
  adapter's `if (!event.spec) continue` ends the turn painting nothing and
  reporting nothing. A constraint 5 violation inside the adopted code.
- A second structure update for the same generation wipes already-landed
  content, so any retry or re-compose path hits it.

## The invariant this decision adds

Carried across from the retired contract, because the defect class survived the
rewrite even though the code did not:

> **Validation failure of one element must not discard the other elements, and
> the surface must reach a resolved state on every path; never a permanent
> shimmer.**

## Process consequence

Two workstreams shared a repository and a base commit but not a contract, and
nothing failed until someone read a branch listing. Before the next parallel
split, the shared contract changes in `packages/schema` first, or the
workstreams agree explicitly that it will not change.
