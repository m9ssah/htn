# Agent orchestration — implementation plan

> LangGraph (TypeScript) in `apps/server`. Single owner. Written at ~hour 10 of 26.
> Confirmed intent is at the bottom; read it if any decision below looks arbitrary.

## The shape

One batched Jev call answers every enumerable judgment at once. A pure policy
function then decides whether to *apply* the template answer. Content is
computed from `TaskState` where it can be, generated where it cannot.

```
START
  │
  ▼
decide ──────────────► SkeletonPatch + StylePatch      Jev, 1 call, ~214ms
  │  route · templateId · 5 axes · gates
  ▼
policy  (pure, no model, ~0ms)
  │  new_task|query   → honour Jev's templateId
  │  refine           → keep current template, apply theme only
  │  correct          → `recovery` when findDeviations() is non-empty,
  │                      else keep current template
  │  select           → deterministic from the touched action
  │
  ├──► project   (pure)  6/8 templates ──► ContentPatch   ~0ms
  └──► generate  (LLM)   2/8 templates ──► ContentPatch × N
                                                  first slot ~1.2s
```

**Measured (p18, 16 cases x 3 reps, $0.0015).** Route is **15/16 correct,
16/16 stable, p50 221ms** alongside `templateId` in the same call. The number
that matters is not 15/16 though — it is that **0 of 16 errors cross a policy
boundary.** The one miss is `"what's the weather like tomorrow"` → `new_task`
instead of `query`, and both of those sit in the *honour Jev's templateId*
branch, so the screen is identical either way. (That gold label is also
arguable: asking about weather with a recipe open is genuinely either.)

**The policy layer is load-bearing, and p18 shows it.** On all nine
`refine`/`correct`/`select` cases Jev's `templateId` was discarded — and it
needed to be. `"make it high contrast, I can't read this"` returned
`focus_step` while the current surface was `item_detail`; all three `refine`
cases would have swapped the surface out from under the user. `correct`
returned `recovery` 3/3 unprompted, which is why the policy row above sends it
there rather than keeping the current template.

**p18 graded route but never graded `templateId` — and when I graded it
afterwards, it was 1/7 on the branch that paints.** "Stable across reps" is not
"correct"; a wrong answer can be perfectly stable, and six of the seven
`new_task`/`query` cases stably returned `generic_answer`, including the demo
opener *"what should I make tonight"*. p14 answered `choice_cards` for that same
utterance. So p18's route number stands and its `templateId` number is
superseded by p18b/p18c below.

**Three variables, isolated (p18b, p18c — 9 honoured cases × 3 reps × 5 arms).**

| arm | question wording | state | route batched | descriptions | correct |
|---|---|---|---|---|---|
| p18 | hypothetical | full | yes | base | 1/7 |
| A | p14's declarative | full | no | base | 7/9 |
| B | hypothetical | full | no | base | 4/9 |
| C | p14's declarative | utterance only | no | base | 8/9 |
| **D** | p14's declarative | full | **yes** | base | **8/9** |
| **E** | p14's declarative | full | yes | **tuned** | **9/9, 9/9 stable, 230ms** |

**Wording was the main cause, and it was mine.** p18 asked *"**If** the
interface **were to** switch to a new layout, which one fits?"* A hypothetical
framing, next to a `generic_answer` described as *"anything unscripted"*, pulls
the answer into the catch-all. p14's declarative *"Which template should the
interface switch to?"* recovers 3 of the 4 lost cases on its own (B→A).

**Batching does not degrade `templateId` — it slightly helps** (A 7/9 → D 8/9).
That is the risk p18 set out to test and tested wrongly, by inferring it from
rep-stability instead of from a non-batched baseline. Now it is measured against
one. Adding `currentTemplate`/`taskState` costs one case (C 8/9 → D 8/9, with
the miss moving), and it stays because `route` cannot be answered without it.

**The last two errors were the option descriptions, not the model.** Narrowing
`generic_answer` to *"a question that wants a factual ANSWER and no change to
the task; not for choosing, not for starting something"* and letting
`choice_cards` own *"the user is deciding WHAT to do and has not chosen yet"*
takes it to **9/9**. The demo opener now lands on `choice_cards`.

**Therefore the option descriptions are a tuned artefact, not documentation.**
They live in version control next to the question text, they are what P2's
table tests are written against, and changing one is a measurement, not an
edit. This is the single highest-leverage surface in the whole decision layer:
it moved accuracy 8/9 → 9/9 at zero latency cost, where no architectural change
was available to do the same.

**Why route is inside the batch but gates outside it.** Questions are free
(p02: 1q 381ms, 32q 362ms), so asking route costs nothing extra. But route
decides whether the template answer is *used* — p14 shows `"make it high
contrast, I can't read this"` classified as `generic_answer`, which on the
device replaces the whole surface when the user only wanted contrast. Jev is not
wrong there; the policy layer is missing.

**Why projection matters more than any latency trick.** Six templates are
computable from `apps/server/src/domain/recipe.ts` — including their button
labels, which relabels the hardware at skeleton time. That removes the model
from the critical path for 6/8 surfaces and is the only thing that makes
`CLAUDE.md` constraint 3 true for them.

## Node inventory

Every node has the same shape, which is what makes "run one alone" free:

```ts
type Node<In, Out> = { name: string; run(input: In, ctx: Ctx): Promise<Out> }
type Ctx = { jev: JevClient; content: ContentSource; sink: PatchSink;
             now: () => number; telemetry: (e: Event) => void }
```

| node | kind | I/O | how it is tested alone |
|---|---|---|---|
| `decide` | Jev | `ctx.jev` | replay recorded fixtures |
| `policy` | **pure** | none | table test |
| `style` | **pure** | none | table test |
| `project` | **pure** | none | table test against `TaskState` |
| `generate` | LLM | `ctx.content` | stub, then replay |
| `research` | fetch | `ctx.fetch` — **`fetch` is not in `Ctx`; see defect below** | stub |

Three implementations behind every interface — **real** (HTTP), **replay**
(recorded), **stub** (hand-written). CI runs on stub + replay: no key, no
network, no spend.

Timing is in the wrapper, not in each node, so every node is measured for free:

```ts
const timed = <I,O>(n: Node<I,O>): Node<I,O> => ({ ...n, run: async (i, c) => {
  const t0 = c.now(); const out = await n.run(i, c);
  c.telemetry({ node: n.name, ms: c.now() - t0 }); return out; } });
```

## Where the model learns the JSON shape

It mostly doesn't. Jev picks from a finite list and **you** build the patch in
TypeScript. Only `generate` needs a slot spec.

**Corrected — an earlier draft of this plan was wrong here.** Walking
`TEMPLATES[id].tree` (`templates.ts:22-44`) yields slot ids and *component
kinds*, and that much cannot drift from what the renderer paints. But the
**value shape per kind** is not in the tree at all — it lives only in
`SlotValue` (`schema/src/index.ts:126-157`), a type, which does not exist at
runtime. `Slider` needs `label/min/max/step/value`; `ListItem` needs
`title/detail?/meta?`.

So one hand-maintained kind → shape table survives, in exactly one place
(`backend/probes/p14_e2e.py` already has one to copy). Two consequences:

- **The sink validates shape, not just kind.** A `Slider` missing `min` passes a
  kind check, and `rail.ts:76` then computes `(value - undefined) / (max -
  undefined)` → `NaN%` width. The existing guard only covers `max === min`.
- **`apps/server` must reference `packages/renderer`.** Its
  `tsconfig.json:10` lists only `schema` and `tokens`. Renderer is
  teammate-owned, so this is a cross-ownership dependency — raise it rather than
  just adding the line.

## What the LangGraph spike settled

`backend/probes/p19_langgraph_stream.mjs` (8 runs) and
`p19b_langgraph_cancel.mjs` (4 runs), against `@langchain/langgraph` **1.4.16**. It was built to answer architecture
questions, not to confirm the API exists — five of the nine answers changed
something in this plan.

| # | question | answer |
|---|---|---|
| 1 | Does a patch escape **before the graph completes**? | **Yes.** Skeleton reached the consumer at **211ms** while `generate` ran for another 5s. |
| 2 | Per-patch framework overhead? | **0–1ms.** 13 slots ≈ 13ms total. Not a budget line. |
| 3 | If a node throws at slot 7, do slots 1–6 survive? | **Only if the consumer has already drained them.** Fast consumer 6/6; at 150ms/chunk 3/6; at 300ms/chunk 2/6. `controller.error()` discards the queue. |
| 4 | Does `writer` work inside a nested async generator? | **Yes.** It is a plain closure on `config`; no special context. |
| 5 | Do fan-out branches really run concurrently? | **Yes.** `decide`(200ms) ‖ `style`(250ms) → second write at **254ms**, not 454ms. |
| 6 | Does a slow consumer stall the node? | **No.** Under 300ms/chunk consumer lag every `wroteAt` was identical to baseline (305/405/505/606/706ms); only `got` drifted. |
| 7 | Can telemetry ride the same stream? | **Yes.** `streamMode: ["custom","updates"]` multiplexes; `updates` arrives *after* that node's custom writes. |
| 8 | **Barge-in: does cancelling the stream stop the node?** | **No.** `break`, `AbortController.abort()` and `iterator.return()` all leave `generate` running to completion. |
| 9 | What does stop it? | Threading `config.signal` into the node's **own** await. Stopped at 757ms, zero leaked slots. |

**What changed as a result.**

**(1) confirms paint-first at the orchestration layer and kills the combine
node for good.** This was the one assumption the whole shape rested on: that
`graph.stream()` yields mid-node rather than at graph exit. It does. A join
node would have held the 211ms skeleton hostage to the 5s content node.

**(3) is conditional, and the condition bites — the catch stays inside the
node.** My first reading of Q3 was wrong and it is worth recording why, because
the mistake is the kind this whole spike exists to catch: **Q3 and Q6 were
measured separately and they are mutually exclusive.** `config.writer` enqueues
on a `ReadableStream`; a node error reaches the consumer via
`controller.error()`, and per the WHATWG Streams spec erroring a controller
**resets its queue** — anything enqueued but not yet read is discarded. So the
"writes survive a throw" result held only because my Q3 consumer was infinitely
fast. Measured with a throw at slot 7, six writes before it (p19c):

| consumer lag | delivered |
|---|---|
| 0ms (the Q3 condition) | 6/6 |
| 150ms/chunk | 3/6 |
| 300ms/chunk (the Q6 condition) | 2/6 |

**The fix is to never let the error reach the controller.** `generate` catches
its own failure, emits a fault patch, and **returns normally**. p19d: 6/6
delivered at 0, 150, 300 *and* 600ms lag, with the fault patch arriving too.
Two consequences the plan now depends on:

- **`generate` keeps an internal `try/catch`.** Not the consumer's job.
- **The sink must be synchronous per chunk.** An `await` inside the `for await`
  — appending JSONL, awaiting validation, awaiting a send callback — recreates
  exactly the lag that loses writes. Buffer the turn log in memory and flush
  once at turn end in a `finally`, so abort and crash still flush.

**(6) says the transport, not the graph, owns dropping — and the buffer is
where (3) goes wrong.** `config.writer` is fire-and-forget into an unbounded
buffer. Good: a slow WebSocket can never stall the Jev call or the LLM, and
`ws.send` is non-blocking so the socket is not what makes a consumer slow. At
≤14 patches per turn the buffer is not a memory concern. **The buffered chunks
are, however, precisely the ones an error discards** — which is why the sink
being synchronous is a reliability requirement and not a style preference.
One more edge: pushing after the stream is closed silently returns, so a node
still running after the consumer has left writes into nothing, with no
telemetry. That is (8)'s problem, not a separate one.

**(8)+(9) are the ones that would have bitten at hour 22, and they add a field
to `Ctx`.** Barge-in is the *common* case on a voice device: the user speaks
again while `generate` is still dribbling slots. p19b shows that nothing on the
consumer side stops the node — not breaking out of the `for await`, not
`AbortController.abort()` on the config signal, not `iterator.return()`. In all
three the node ran all ten slots to completion, 2.2s past the point the consumer
walked away. The `AbortError` surfaces at the *consumer*; the node never hears it.

**Cancellation is cooperative.** `config.signal` *is* present inside the node —
it is simply never enforced. A node that threads it into its own await stops
immediately (757ms, zero leaked slots). So:

- `Ctx` gains **`signal: AbortSignal`**, taken from the node's `config`.
- **One `AbortController` per turn.** A second utterance aborts the first.
- The Jev client's `fetch` takes `{ signal }` — this is also what makes the
  ~1.5s hard deadline actually release the socket rather than just stop waiting.
  `AbortSignal.any([ctx.signal, AbortSignal.timeout(HARD_MS)])` gives the
  deadline and the barge-in from one object.
- `generate`'s LLM stream takes `{ signal }`, checked between slots.
- **No retry policy on `generate`.** LangGraph re-runs a node's writers on
  retry, so a retried `generate` re-emits every slot it already emitted.
- Do **not** use `stream.cancel()`: it raises `TypeError: Invalid state:
  Releasing reader` and still delivered a chunk after the cancel.

**This does not replace the turn-gated sink, it completes it.** The sink stops a
stale patch from *painting*; the signal stops the stale turn from *costing* and
frees the connection. Without both, every interrupted utterance pays for a full
`generate` — and on a device where barge-in is the normal way to correct
yourself, that is most turns. With p17's 5s and 21s tails a leaked `generate`
can span three turns, and two overlapping turns with no cancel run both
`generate`s to completion concurrently.

**(7) makes the observability channel free.** Node-boundary events and patches
come out of one iterator, already ordered, so the JSONL turn log needs no second
subscription. (5) is banked, not spent: the plan has one batched Jev call, so
fan-out matters only if `style` is ever split back out.

**One gotcha worth writing down.** `streamMode: "custom"` yields bare payloads;
`streamMode: ["custom"]` — the array form, even with one entry — yields
`[mode, payload]` tuples. The sink must destructure on the array form, not on
`modes.length > 1`.


## Phases

**Two measurements come before any TypeScript.** Both run in the Python harness
that already exists, and both de-risk the spine rather than the plumbing.

| # | what | done when | est |
|---|---|---|---|
| ~~M1~~ | **route probe — DONE.** `backend/probes/p18_route.py` | 15/16, 16/16 stable, 221ms p50, 0 policy-boundary errors | ✅ |
| ~~M2~~ | **streaming + cancellation spike — DONE.** `p19_langgraph_stream.mjs`, `p19b_langgraph_cancel.mjs`, 12 runs vs `@langchain/langgraph` 1.4.16 | skeleton escapes at 211ms while `generate` runs 5s more; 0–1ms per patch; pre-throw writes survive only if the sink is synchronous; **cancellation is cooperative** | ✅ |

The route decision is the spine of this design. It is now measured (p18) and it
holds. **Both measurements are done; TypeScript starts at P1.** Confidence still does not separate right
from wrong — lowest correct 0.467, highest wrong 0.547 — which independently
confirms abandoning the confidence gate, exactly as p13 found for `templateId`.

Then, in this order. **P1 → P3 → P2**, not P1 → P2 → P3:

| # | what | done when | est |
|---|---|---|---|
| ~~**P1**~~ | **DONE** — `agent/p1-node-harness` @ `b39f43f`. `Node`, `Ctx` (incl. `signal`), `timed`, stub/replay clients, `beginTurn` epoch gating, CLI | 110 tests green; `npm run node -- decide "..."` prints output + ms | ✅ |
| ~~**P3**~~ | **DONE** — `agent/p3-jev-decide` @ `ae50cb7`. `JevHttpClient` on `node:https` + keep-alive Agent, budget cap, `AbortSignal.any`, tuned questions module, real `decide` | 133 tests green offline; **warm p50 211ms**; black-hole destroys the socket; 4 fixtures recorded; $0.00087 spent | ✅ |
| **P2** | pure nodes: `policy`, `style`, `project` | table tests green, written **against recorded distributions** | 1h |
| **P4** | LangGraph wiring, `config.writer` per patch, turn-gated **synchronous** sink, shape validator, buffered JSONL flushed in a `finally` | 10 held-out utterances → valid patches; log greppable by `turnId`; **crash-under-lag test loses 0 patches** | 1h |
| **P5** | `generate` for `message_drafts` + `generic_answer`, streaming per slot, nulls first, `signal` checked between slots | first slot ≤1.5s end-to-end (p19 proved the framework half; this is the model half); barge-in test emits 0 slots after abort | 1h |

**Why P3 moves ahead of P2.** `policy`'s table tests written before any recorded
Jev output are guesses about what Jev returns. Recording fixtures in P3 first
turns P2's tables from assumptions into evidence. Nothing in P1 changes.

**P0 is cut.** The earlier draft opened with a fake patch source + websocket to
unblock the device workstream. That benefit is small — the teammate can code
against `Patch` today with a 20-line fake — and its done-when required a ws
client in `apps/device/src/main.ts`, which is teammate-owned and so not
falsifiable solo. It also traced to nothing in the spec: constraint 6 is *"the
flow is never hardcoded"*, and a fake source walking `TEMPLATES` **is** a
hardcoded flow. The ws work folds into P4. Reinstate it only if the device
teammate asks for a running server.

**Work this plan previously left out**, all P2-sized:

- **Seed data.** `project` claims 6/8 templates, but `choice_cards` and
  `people_picker` need data that does not exist — `recipes.ts` has one recipe,
  and there are no contacts anywhere in `apps/server`.
- **The `correct` route needs extraction.** `applyDeviation` (`recipe.ts:143`)
  takes an ingredient and a factor. Neither is in the batched question list.
  That is the recovery beat — the demo's biggest moment — and it was missing.
  Add a `choice` over `recipe.ingredients` and a `choice` over
  `{half, 1.5x, 2x, 3x, other}`, both free to ask in the same call.
- **`style` needs a gate.** p14 shows Jev picks a theme on *every* utterance
  (`"show me the whole recipe"` → contrast/editorial/sharp). Without a noul
  asking *"does this utterance express a visual preference?"*, every single
  utterance restyles the device.

## What P1 changed in this plan

Built and reviewed in two stages; both stages found defects the implementer's
green test suite did not.

- **`Ctx` gained `signal`** and the p19b finding is now a comment on the field
  itself, where P3 cannot miss it.
- **`PatchSink.emit` returns `void`.** The stronger claim I originally wrote —
  *"a later phase cannot `await` it even by accident"* — is **false**: TS permits
  `await` on `void`. The achievable property is that `emit` cannot do I/O, so an
  awaited call costs one microtask rather than a socket round-trip. That is
  sufficient for what p19c/p19d measured.
- **Turn gating is a monotonic epoch, not turn-id equality, and the method is
  `beginTurn`.** Gating on the id resurrected a dead sink when an id was reused
  (`t1 → t2 → t1` brought the first `t1` sink back to life) — the probe-17
  stale-patch failure, reintroduced by the mechanism built to prevent it.
  Dropped patches now fire an `onDrop` hook, per constraint 5.
- **`JevClient.ask(utterance, signal)` needs a breaking input change in P3.**
  p18 measured that route is unanswerable from the utterance alone, so `ask`
  must also take `currentTemplate` and `taskState`. Additive widening of
  `JevAnswer` is free; this is not.
- **`research` has no owning phase** — see the spec defect above. Surfaced by
  trying to register it.
- The replay clients had to be taught to honour `signal`; they shipped
  violating the harness's own stated invariant. `await sleep(0, signal)` is
  load-bearing — `signal.throwIfAborted()` never yields, so a timer-scheduled
  abort would not land before a read finished.


## Correcting the keep-alive number

This plan said **412ms cold → 152ms warm p50**, measured in Python. P3 measured
the TS path for the first time and the honest picture is different — not worse,
but the 152ms figure was never comparable to what we actually send.

| | shape | warm p50 |
|---|---|---|
| p10 (where 152ms came from) | **single question**, minimal state | 150–223ms across rows; 152 was a *fast* row, not typical |
| p18 (Python) | route + templateId, real state | 221ms |
| p18c (Python) | 7 questions, real state | 230ms |
| **P3 (TypeScript)** | **7 questions, real state** | **211ms** (n=10) |

So **TypeScript is on par with Python — marginally faster** — and the
keep-alive story holds on the runtime we ship. What does not hold is quoting
152ms for a production call: that was a minimal single-question probe, and the
production shape costs ~210–230ms in *either* language. Quote **211ms** and cite
P3, or quote 221/230ms and cite p18/p18c. Do not quote 152ms.

Cold in TS: 507–596ms (n=3), consistent with Python's 412ms order of magnitude
given a larger body.

**The idle-gap question, which nothing had asked.** After a 30s pause with no
traffic the next call took 266ms — warm range, not cold. The pooled connection
survives a realistic gap between utterances, so `warmup()` at boot is not dead
weight and the socket does not need re-warming mid-session.


## Reliability

**Turn IDs live in the sink, not the patch.** Probe 17 saw 5s and 21s tails, so
a late patch from a previous utterance can land in the current surface. Adding
an epoch to `Patch` is a contract change under "Ask me before"; a `PatchSink`
that drops patches whose turn ≠ current needs no schema change and is testable
in isolation.

**`decide` is the single point of failure, and the fix is not a fallback
surface.** An earlier draft proposed painting `generic_answer` on timeout. That
is wrong: on a `refine` utterance it replaces the current surface, which is the
exact failure the policy node exists to prevent. **When the route is unknown,
the only safe move is to keep the current surface.**

The spec already has the honest state. `CLAUDE.md:148` says that below the
confidence threshold the device dims and *asks* rather than guesses, and
`apps/device/src/emoticon.ts:21` already implements an `unsure` mood — *"Below
the classifier's confidence threshold — visibly unsure, not guessing."* Nothing
triggers it today.

Slow and failed are also different things, and one threshold cannot express
both:

| | behaviour |
|---|---|
| **soft deadline ~500ms** | keep waiting, face `thinking`. p01 measured 746ms at 50 options and p02 699ms at 64 questions — a late answer is usually still the *right* answer |
| **hedge at ~350ms** | fire a duplicate on a second pooled connection, take the first to return. At ~$0.00003/call this converts the tail into negligible cost instead of into a wrong surface |
| **hard deadline ~1.5s** | declare failed: current surface (or home) stays, face `unsure`, telemetry `decide-degraded`. Never paint a new template on an unknown route |
| low confidence | still apply — confidence does not separate right from wrong (p13: wrong at 0.723, correct at 0.317) |
| `generate` over ~8s | skeleton and style stay, slots keep shimmering, telemetry `generate-timeout`. No invented content |
| `generate` **throws** mid-stream | **catch inside the node**, emit a fault patch, return normally (p19d). Letting the error reach the stream controller discards every undelivered chunk — 2/6 survived at 300ms consumer lag (p19c). Keep the filled slots, shimmer the rest, telemetry `generate-crashed` |
| `project` hits a domain bug | return the slots it computed, never throw |
| **user speaks again mid-`generate`** | abort the turn's `AbortSignal`. p19b: this only works if the node threads `ctx.signal` into its own await — LangGraph does **not** interrupt an awaiting node, so `break`/`abort()`/`.return()` alone leak the whole remaining generation. Sink drops by `turnId`, signal stops the spend |

**Touch is unaffected by any of this.** `select` is deterministic from the
touched action and needs no Jev at all, so every tap-driven beat survives Jev
being dead. Done-when 5 tests both halves.

*Unmeasured:* the 500ms/1.5s/350ms numbers. n≈7–8 per probe row with no p99;
p14's max was 491ms. Treat them as starting points and re-cut them from the
turn log once P4 is emitting one.

**Pure nodes are total.** `policy`, `style` and `project` never throw. They
return a partial result and emit telemetry. This matters because the domain
layer has at least one live bug (`applyScaleUp`), and a throwing `project` turns
a wrong number into an empty screen.

**Validate generated slot values at the boundary.** TypeScript covers everything
you write, but `generate` output is runtime data from a model. Walk
`TEMPLATES[id].tree` and reject values whose `kind` does not match the slot
before they reach the sink — this is `plan-v1.md:98` step 21, and it belongs in
the sink so every producer crosses it.

**Warm the connection at boot.** A cold TLS handshake costs ~260ms — 63% of a
Jev call. Measured 412ms cold vs 152ms warm — *in Python's `http.client`; the TS
path is unmeasured.* Node's global `fetch` will not hold the socket: undici's
default `keepAliveTimeout` is 4s, so a 30s idle ping warms nothing. Use an
explicit `https.Agent({ keepAlive: true })` or an undici `Agent` with a raised
timeout, and note there is no ping endpoint — a warmup must be a real minimal
evaluate call.

## Observability

Per-node milliseconds are the floor, not the goal. Four things make the
difference between "it was slow" and "I know why":

**A `turnId` on every event.** One utterance produces one decision, two to
fourteen patches and several node timings. Without a correlation id you cannot
reconstruct a single turn, which is exactly what you need when a surface looks
wrong. Thread it through `Ctx`.

**Log the distribution, not the winner.** Jev returns a probability per option;
logging only the argmax throws away the calibration data. This is precisely how
the `text-them → people_picker` error at 0.723 confidence was found, next to a
*correct* answer at 0.317. Keep the whole distribution per question.

**Log what Jev said *and* what policy applied.** The policy node deliberately
overrides the template answer on `refine`/`correct`/`select`. When the screen
looks wrong, the first question is always "did Jev pick that, or did we?" —
record `jev.templateId`, `applied.templateId`, and the rule that fired.

**Timestamp slots, not just nodes.** Content is the thing that trickles; a
single "generate took 6s" hides the shape. Record each slot's arrival so the
~380ms cadence is visible and regressions in emission order are caught.

**Emit on failure too.** A node that throws or times out is the most interesting
event in the log and the easiest one to lose. The timing wrapper emits in a
`finally`, with the error attached.

**One stream carries both.** p19 Q7: `streamMode: ["custom","updates"]`
multiplexes patches and node-boundary events into a single ordered iterator, and
the `updates` event for a node arrives *after* that node's own writes. No second
subscription, no clock reconciliation between two channels.

One structured JSONL line per turn, appended to a file. It costs nothing, it is
the input to the judge explanation in `docs/latency-evaluation.md`, and
it reuses the analysis already written for the probes.

## Done-when — the agent layer

`plan-v1.md` is entirely pre-pivot (OpenCut, region registry, translation), so
the pivoted product has no falsifiable definition of working. These six are
scoped to what the agent layer owns. Each is a test someone else could run
without asking what was meant.

1. **Unscripted input produces a *correct* surface.** A **held-out list of 10
   utterances, fixed and written down before testing**, → 10 schema-valid patch
   sets, 0 exceptions, **and the template is right for at least 9**. Validity
   alone passes a confidently-wrong template (p13: `people_picker` at 0.723).
2. **A style request does not replace the surface.** `"make it high contrast, I
   can't read this"` keeps the current `templateId` and changes only the theme.
   p14 gets this wrong today (`generic_answer`).
3. **Skeleton beats the budget.** Under 250ms **from `decide` start, warm
   connection** — note this is *not* `CLAUDE.md:44`'s "from end of utterance",
   which also contains STT and the websocket hop and has never been measured.
   State both numbers; do not quote the easier one as if it were the spec's.
4. **A short list does not shimmer forever.** Six ingredients in a template
   reserving eight paints six rows and collapses two. Requires emitting `null`.
5. **A hung Jev degrades visibly, and touch still works.** Point the client at a
   **black hole** (accepts the connection, never responds) — a dead port returns
   `ECONNREFUSED` in milliseconds and never exercises the timeout path. Expected:
   the current surface stays, the face goes `unsure`, telemetry says
   `decide-degraded`, and every touch/button/slider beat still works.
6. **One turn is reconstructable.** Grep by `turnId` → the decision, every patch,
   every node timing.
7. **The turn-gated sink drops a late patch.** Two utterances back to back; the
   first turn's late patch must not write into the second surface.
8. **A malformed generated slot is rejected, not thrown on.** A `Slider` missing
   `min` is refused at the sink and logged — never reaches `rail.ts`.
9. **`refine` with no current surface does not fall through.** First utterance of
   a session classified `refine` must still produce a template.

Cut line: 1, 3 and 5 are the demo. 2, 4 and 6 make it not embarrassing. 7–9 are
the ones that bite at hour 22.

10. **Barge-in stops the spend, not just the paint.** A second utterance while
    `generate` is running → the first turn's `AbortSignal` fires, and the node
    emits **zero** writes after it. Tested with the sink counting writes past the
    abort, because the turn-gated sink would hide a still-running node.
11. **A crash under a slow consumer loses no patch.** `generate` throws at slot 7
    with the sink lagging 300ms/chunk → all 6 earlier slots plus a fault patch
    arrive (p19c is the failing case, p19d the passing one).

## Traceability

| phase | satisfies | how it is verified |
|---|---|---|
| M1 | — (de-risks the spine) | route accuracy is a number |
| M1b | — (p18b/p18c) | `templateId` graded, not just stable: 9/9 with tuned option text |
| M2 | — (de-risks P3/P4/P5) | **done:** skeleton out at 211ms mid-graph; 0–1ms/patch; pre-throw writes survive *only* with a synchronous sink; barge-in needs `ctx.signal` |
| P1 | — (enabling) | one node runs alone and prints its ms |
| P3 | constraint 1, done-when 3, 5 | replay offline; live ≤250ms warm; black-hole test |
| P2 | done-when 2, 9 | table tests against recorded distributions |
| P4 | constraint 5, 6; done-when 1, 6, 7, 8, **11** | held-out utterances; `turnId` grep; late-patch drop; crash-under-lag loses 0 patches |
| P5 | constraint 3 (generated half); done-when 4, **10** | first slot ≤1.5s; nulls collapse two rows; 0 writes after a barge-in abort |

## Spec defects to fix before quoting the spec

`CLAUDE.md` currently contradicts the code in five places. Each is a one-line
edit and each will otherwise be quoted at a judge as though it were true:

- `:241` says `recipe_overview`; the schema has said `item_detail` since `7049df8`.
- `:44` says Jev under 200ms; measured is 214ms p50, range 141–491ms.
- `:286` says `applyScaleUp` is idempotent; it is not when `topups` is non-empty
  (verified by execution). The test re-plans first, so it proves a different property.
- `:117-129` lists `apps/bridge`; it does not exist, and `apps/server` has no
  orchestrator, no Jev client and no websocket.
- `:49-51` says content under 1.5s. Split the clause: **projected** content
  arrives with the skeleton; **generated** content means first slot and button
  slots under 1.5s, last slot best-effort.
- `:148` specifies that below the classifier's confidence threshold the LEDs dim
  and the device asks rather than guesses. This plan **abandons the confidence
  gate** (p13: wrong at 0.723, correct at 0.317 — no threshold separates them),
  which silently drops that specified behaviour. `unsure` is re-pointed at the
  `decide` hard deadline instead. Either update `:148` to say so, or the spec
  describes a device that does not exist.

**`research` is an orphan node, surfaced during P1.** It appears exactly once in
this plan — the inventory row above — and:

- **no phase owns it.** P1 harness → P3 Jev client + `decide` → P2 pure nodes
  (`policy`/`style`/`project`) → P4 wiring → P5 `generate`. Nothing implements
  `research`.
- **its I/O column references `ctx.fetch`, which is not a field of `Ctx`.** The
  `Ctx` defined directly above it is `{ jev, content, sink, signal, now,
  telemetry }`. The inventory cites a context field the type does not have.

P1 ships it as a node that throws *"no phase in the plan owns this node yet"*,
which is the honest state. Decide before P4 whether `research` is in scope at
all; if it is, `Ctx` gains `fetch` and a phase gains a row. The architecture
diagram shows a research chain, so this is a real gap, not dead text.

## Known-stale things this plan depends on

- `backend/schema_contract.json` was a hand-made snapshot and went stale when
  `recipe_overview` became `item_detail` in `7049df8`. Re-extracted, but the
  orchestration must not use it — walk `TEMPLATES` instead.
- `renderer.ts:204` clears `slotElements` but not `content`, so same-template
  transitions paint stale text. Not this plan's scope; it will be visible the
  moment P4 lands.
- `applyScaleUp` is not idempotent when `plan.topups` is non-empty (verified by
  execution: butter 1→2→3 on a second press). `CLAUDE.md:286` claims otherwise.

## Two questions that are design choices, not latency ones

**Do control events go through the graph?** Per-invocation graph overhead is
0.6ms p50 (trivial node, n=20, 3.8ms warmup max) — far inside the one-frame
budget, so latency does not decide this. **They bypass it.** A slider scrub
emits a cached content patch and must not depend on graph state being
consistent mid-turn; routing it through the graph would also make a physical
control abortable by a barge-in, which is wrong.

**Is there a checkpointer on the render path? No.** `TaskState` lives outside
the graph in `apps/server`, so a checkpointer would serialize state per
superstep on the critical path and buy nothing. If replay is wanted later, the
JSONL turn log already has it.

## Reproducibility

p19–p19d are JavaScript and do not run from `backend/`'s Python env. Pinned:
**Node v26.4.0** (note `CLAUDE.md` pins **24** for the app — these probes were
not run on it), `@langchain/langgraph` **1.4.16**, lockfile at
`backend/results/p19_package-lock.json`, console output at
`backend/results/p19_langgraph.txt`. Reproduce with
`npm i @langchain/langgraph @langchain/core` in a scratch dir and run the four
`.mjs` files.

## Asserted here, not measured

Flagged so nobody quotes them at a judge as findings:

- ~~Route accuracy~~ — **measured**, p18: 15/16, 0 policy-boundary errors.
  Caveat: 16 cases, gold labels written by the same author who wrote the
  cases. Not held out. **`templateId` accuracy is p18b/p18c's 9/9, not p18's**
  — same caveat, and 9 cases is fewer still.
- **The tuned option descriptions are fitted to those 9 cases.** 9/9 on the set
  they were tuned against is the weakest possible evidence. Re-grade on held-out
  utterances before quoting the number.
- **500ms / 1.5s / 350ms deadlines.** Starting points from n≈7–8 rows with no
  p99. Re-cut from the turn log after P4.
- **TS keep-alive behaviour.** The 412→152ms figure is Python `http.client`.
- **"Skeleton < 250ms"** is Jev alone; end-to-end with STT and websocket is
  unmeasured.
- **"First slot ~1.2s"** came from a stripped `claude -p` run that includes
  ~570ms of CLI spawn. In-process is projected at 600–1000ms
  (`docs/latency-findings.md`) — cite which one you mean.
- **`project` "~0ms"** — plausible for pure arithmetic, never timed.

---

## Confirmed intent

- **Outcome** — an implementation plan for LangGraph (TypeScript) agent
  orchestration in `apps/server`.
- **User** — the author, sole owner of the agent layer. Renderer, device shell
  and hardware belong to teammates.
- **Why now** — the orchestrator is zero lines; `script.ts` is a hardcoded flow,
  so `CLAUDE.md` constraint 6 is currently false and it is the product thesis.
- **Success** — every node runs and is tested alone with no network and no key;
  real per-node timing is visible; skeleton under 250ms three times running.
- **Constraint** — TypeScript; the patch contract does not change; ~hour 10 of
  26, so the plan must survive being cut in half.
- **Out of scope** — the dev overlay and step 20's telemetry panel; the renderer
  and domain bugs above; porting the Python probes (they stay as the calibration
  tool); any investment in scalability.
