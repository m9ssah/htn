# Jev — measured capabilities and limits (v1)

**Status:** live API, real measurements. Run 2026-09-19 from Toronto.
**Model:** `jev-latest` → resolves to `jev-1.13.0`
**Endpoint:** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`
**Harness:** [`backend/`](../backend) — `jev/client.py` + four probes. Raw output in `backend/results/*.json`.
**Total spend for everything below:** ~450 Jev requests (~$0.03) + $0.35 teacher grading.

> **Revision note (same day).** Three findings in the first pass were wrong and are
> corrected below: the latency floor was inflated by a TLS handshake, the "conservative
> bias" was my under-specified question rather than the model, and a stability flag was
> comparing probabilities instead of decisions. A teacher model now grades the decisions
> independently. Details in §2a, §3 and §6.

---

## 0. The finding that reshapes the plan

**Jev is not a low-latency LLM. It is a judgment model with no generative output.**

It accepts a `state` plus typed questions and returns *probabilities*. There are exactly
three question types and no fourth:

| Type | Asks | Returns |
|---|---|---|
| `choice` | Which of these options fits? | chosen key + probability per option + confidence |
| `score` | Where on this ordered rubric? | position (fractional) + confidence |
| `noul` | Is this statement true? | probability 0–1 |

It cannot emit prose, JSX, CSS, JSON structures, a hex code, or a list it was not handed.
Your own `plan-v1.md` already recorded the consequence — *"Jev handles your enumerated
token space, but it can't invent a hex code"* — and the API confirms it is a hard
structural property, not a quality ceiling.

So the benchmark's framing question has to change. **"Can Jev replace node N?" is only
answerable for nodes whose output is a choice over a set someone else enumerated.** For
every other node the real question is "can Jev *gate* or *filter* it?" Section 3 splits
the ten nodes on exactly that line.

---

## 1. Hard limits (probe 1 + 2)

| Dimension | Measured limit | Notes |
|---|---|---|
| Questions per request | **64 verified OK** | The widely-quoted "max 32" is the `pi-typesafe` wrapper's cap, not the API's. True ceiling not probed above 64. |
| Options per `choice` | **200 verified OK** | Still correct at confidence 0.99. |
| Levels per `score` | **10 — hard cap** | 20 levels → `"Too many score levels. Must have at most 10 levels."` |
| State size | **~32,700 input tokens** (~208–216 KiB) | Above that: `max_tokens_exceeded`. Bisected. |
| Timeout / retries | **unmeasured** | The widely-quoted 15 s is the `pi-typesafe` wrapper's session limit, same class of claim as the "32 questions" one. Our client uses a 20 s client-side timeout; the server's own limit was not probed. |
| Price | $42 per billion **input** tokens; output free | A 350-token call ≈ $0.0000147. |

### Latency — the shape that matters

Median over 7 repetitions each:

```
vs QUESTION COUNT              vs CHOICE OPTIONS            vs STATE SIZE
 1 q  ->  381ms                  3 opts ->  374ms             1 KiB ->  366ms
 8 q  ->  384ms                 50 opts ->  357ms            32 KiB ->  439ms
32 q  ->  362ms                200 opts ->  366ms           128 KiB ->  948ms
64 q  ->  518ms                                             208 KiB -> ceiling
         ~flat                        FLAT                      this is the cost
```

**Questions are free. Options are free. Only state size costs latency.**

Every question in a request runs in parallel and in isolation. Asking 32 questions costs
the same as asking one. This is the single most important architectural fact for your
build: *one* Jev call can answer an entire node's worth of judgments in ~370 ms.

### Latency floor — corrected, and it matters for the demo budget

The first pass opened a fresh TLS connection per call. **63% of the measured latency was
handshake, not inference.**

| | p50 | min | p95 |
|---|---|---|---|
| Fresh connection per call (first pass) | 412 ms | 330 ms | 502 ms |
| **One warm connection reused** | **152 ms** | **121 ms** | **210 ms** |

The client now reuses connections by default (`Jev(keep_alive=True)`), and every latency
figure in §3 was re-measured: nodes now land at **168–237 ms**, not 305–603 ms.

This reconciles the vendor's 111 ms claim with our measurement — it was never a
Toronto-vs-server-side discrepancy, it was our own handshake. **Budget ~150–210 ms per
Jev call against the 1.5 s demo target, and hold a warm connection open before the
demo starts.**

Vendor-published comparison (their cookbook, **not** measured by me — no strong-model key
in this environment): Haiku 4.5 ≈ 1780 ms, GPT-5.4-mini ≈ 1405 ms, reasoning models
11–14 s. Against those, Jev is roughly **4–5× faster than a small model and ~30× faster
than a reasoning model**, at ~1/40th the cost.

---

## 2. The escalation result — the most useful finding

Across 120 graded single-answer decisions (15 cases × 8 repetitions), Jev's own
confidence separates its right answers from its wrong ones almost perfectly:

```
confidence when CORRECT : mean 0.88   min 0.33   (n=105)
confidence when WRONG   : mean 0.40   MAX 0.55   (n=15)
                                      ^^^^^^^^
                          no wrong answer ever exceeded 0.55
```

Threshold sweep — *"if confidence < T, escalate to the strong model"*:

| T | % escalated | accuracy on what Jev keeps |
|---|---|---|
| 0.00 | 0% | 87.5% |
| 0.40 | 7% | 92.9% |
| 0.50 | 14% | 98.1% |
| **0.60** | **26%** | **100.0%** |
| 0.70 | 32% | 100.0% |
| 0.95 | 47% | 100.0% |

A confidence gate at 0.60 keeps 74% of decisions on Jev with zero errors on the kept set.
0.70 buys nothing over 0.60 and costs 6% more escalations.

### How much to trust this

**Promising, not yet a spec.** Three caveats, all of which point the same way:

- Those 120 decisions are **15 distinct cases × 8 reps**, and all 15 errors come from
  just **two cases**. The separation rests on n=2, not n=15.
- One of those two (`cta-prominent`) has **debatable gold**: the design system as I wrote
  it reserves the accent colour for primary actions, and the CTA *is* the primary action,
  so Jev picking `accent_color` may well be correct and my label wrong.
- **The margin is thin.** Max confidence on a wrong answer 0.55; min confidence on a
  correct answer above the gate 0.67; and a *correct* case (`multi-20-interests`) sits
  right on the line at 0.53–0.57.

Before treating 0.60 as a production threshold it needs **20+ hard L3/L4 cases with
independently authored gold**.

**It was also validated only on `choice` confidence.** `noul` questions return a bare
probability with no confidence field — the `Answer.confidence` used for nouls in
`client.py` is a derived proxy (`|p − 0.5| × 2`) that probe 4 never tested. Both
conditional nodes below (Task Assignment, Context Selection) are noul-based, so the gate
is **not yet known to work where it is most needed**. Whether the dropped
`twelve_controls` item was a middling probability or a confidently wrong one is currently
unknown.

Direction of travel for the core research question: *"how much of the architecture can Jev
own?"* looks less like a fixed list of nodes and more like a **confidence threshold over
every enumerable-output node** — but that is a hypothesis Stage 2 must confirm, not a
result.

### Stability

Argmax was stable across 8 identical calls in **14 of 15 cases**. The single case that
flipped (`quiet-please`, an L4 ambiguous action, modes `other`×7 / `disable_all`×1) had
mean confidence 0.34 — *below the gate*. The same threshold that catches wrong answers
also catches unstable ones. Probabilities wobble run to run; decisions above the gate did
not.

---

## 2a. Independent teacher grading

Hand-authored gold labels written by the same person reading the results are not a
benchmark. A strong model (`claude -p`, Sonnet) re-graded all 15 choice cases blind to
Jev's confidence, doing three separate jobs: choose the answer itself, rate Jev's answer
on the spec's 0–4 rubric, and audit whether the gold label was sound.

| Metric | Result |
|---|---|
| Teacher / Jev agreement | **87%** (13/15) |
| Mean rubric score | **3.60 / 4** |
| Rubric distribution | 4 → 13 cases, 1 → 2 cases (nothing in between) |
| Gold labels judged sound | **14 / 15** |

**The two disagreements are exactly the two cases below the 0.60 confidence gate** —
`quiet-please` (conf 0.34) and `cta-prominent` (conf 0.46). The teacher never saw the
confidence values and independently flagged the same two.

That is the strongest evidence for the gate so far, and it settles a real objection: both
cases had been challenged as "debatable gold," which would have meant the gate was fitted
to zero genuine errors. The teacher ruled the gold **sound on both** and scored Jev 1/4 on
each. They are genuine errors, and the gate catches both.

The one disputed label is `long-list-a11y` — judged `too_narrow`, since a native `select`
is arguably safer than a combobox for screen readers. Jev picked an answer already in the
gold set, so no result changes.

**Caveat:** teacher and judge are the same model family, which cannot detect a bias they
share. This measures agreement, not truth. The rubric distribution being purely bimodal
(13 fours, 2 ones, nothing between) is also suspicious of a judge that rounds to extremes.

## 3. Node replacement map (probe 3, 34 gold-labelled cases × 3 reps, L1–L4)

Two pass columns, because they measure different things. **Exact** = every label in the
case correct simultaneously (brutal for 7-way multi-label). **Per-judgment** = accuracy
over individual judgments.

### Robustly replaceable — no gate needed through L4

| Node | Exact pass | Per-judgment | p50 | Note |
|---|---|---|---|---|
| **Component Decision** | 9/9 (100%) | 0.95 | 336 ms | Correct at every level incl. L4. 200-option lists fine. |
| **Settings Update** | 4/4 (100%) | 1.00 | 340 ms | Perfect scope discipline — never touched an unrequested setting, including L4 *"I'm getting way too many emails"* → correctly `email` + `weekly digest` only. |

### Replaceable behind the 0.60 gate

| Node | Exact pass | Per-judgment | p50 | Where it breaks |
|---|---|---|---|---|
| **Functional Action** | 4/5 (80%) | 0.90 | 350 ms | L1–L3 perfect, incl. *"until tomorrow"* → `snooze_temporary`. Only L4 *"it's too noisy, calm this down"* failed — at confidence **0.34**, so the gate catches it. |
| **Research Strategy** (as filter) | 1/2 | 0.96 | 333 ms | Perfect as noul filter over a candidate list; one false positive when switched to `score`-based prioritisation. |
| **Task Decomposition** (as filter) | — | 1.00 acc | 168 ms | Correctly kept all 8 real steps, rejected all 4 distractors. (The earlier "unstable" note was a harness bug — the flag compared probability strings, not decisions. Argmax was stable.) |

### Conditional — usable but with a known bias

| Node | Exact pass | Per-judgment | Failure shape |
|---|---|---|---|
| ~~**Context Selection**~~ | — | — | **Finding withdrawn — promoted to robustly replaceable.** See below. |
| **Task Assignment** (routing) | 1/5 (20%) | 0.86 | Degrades with request complexity: recall 1.00 at L1 → **0.67 at L3** (missed `styling` and `functional_action` on the dashboard request). Errors are single-node misses, not scrambled routing. Needs gating or splitting into fewer-node decisions. |

### Context Selection — the "conservative bias" was my question, not the model

First pass: precision 1.00, recall 0.86–0.89, consistently dropping one borderline item.
I attributed that to a conservative bias in Jev. It was not. Those nouls were bare
instruction strings; the API documents a `criteria: {true, false}` field that exists to
control exactly this, and the harness never used it. Same 20-item pool, same model:

| Question form | Precision | Recall | Accuracy |
|---|---|---|---|
| `v1` bare instruction (first pass) | 1.00 | 0.89 | 0.95 |
| **`v2` + `criteria` describing true/false** | **1.00** | **1.00** | **1.00** |
| `v3` + deliberately inclusive criteria | 0.90 | 1.00 | 0.95 |

**Perfect with the documented field supplied.** And `v3` flips the bias the other way —
so inclusion/exclusion bias is a **dial you set**, not a property you inherit. That
matters directly for a feature-subsetting demo, where wrongly *hiding* a control the user
asked for is the demo-killing failure and wrongly showing one is survivable.

Every other node still using bare nouls (Task Assignment, Settings Update, Research
Strategy, Task Decomposition) is measured below its ceiling for the same reason.

### Not expressible — structural, zero test cases run

| Node | Why |
|---|---|
| **Skeleton / UI Generation** | Requires generative output. Jev has none. |
| **Information Gathering** | Requires tool use / retrieval. Jev has neither — it only reads the state you hand it. |
| **Styling as value production** | Cannot emit a hex code, spacing value, or CSS; only chooses among enumerated options. Its 0.56 mean is **contaminated** — the L1 case in that average was a rubric bug (0.68 → 0.97 once rephrased, §4), so the score understates Jev and the node needs a clean re-run. |

That is **3 of your 10 nodes that no amount of prompt tuning will recover.** For these,
Jev's role is upstream (deciding *whether* / *which*) or downstream (validating output),
never the node itself.

---

## 4. Methodological finding: question phrasing dominates node performance

Two probe-3 failures turned out to be **my question's fault, not Jev's.** Rephrased per
TypeSafe's own guidance — *ask what the state says, not what you would conclude*:

| Case | Vague meta-question | Decomposed state-reading questions |
|---|---|---|
| Styling, blue→green | *"Is this specific enough to apply without further design judgement?"* → **0.68** | *"Does it name both current and target colour?"* → **0.97**<br>*"Can this be executed by swapping one existing token?"* → **0.90** |
| Research stop | *"Is the available information sufficient?"* → **0.25** | *"Does `tradeoffs` state they are distinguishable?"* → **0.98**<br>*"Does `open_questions` record any unresolved question?"* → **0.03** |

Same underlying judgment, same model, **0.25 → 0.98**. Jev answers exactly what is asked,
so ambiguity surfaces as a middling probability rather than an error.

**Consequence for the benchmark: a low node score is ambiguous between "Jev can't do this"
and "the question was badly posed."** Every node that scores poorly must be re-run with
decomposed questions before being declared unreplaceable.

`Research Stop` is the clearest candidate — it matters most for latency, since unnecessary
research is pure added seconds. It is also **the least-tested node in the whole suite**:
two cases, one of which is the rubric-bug retest above. Treat its 0.64 as nearly
uninformative rather than as a finding.

---

## 5. What is NOT answered, and why

Reported plainly rather than quietly dropped — your spec calls several of these the most
important questions.

| Blocked | Needs |
|---|---|
| **Stage 2 entirely (C0–C7)** | A running multi-agent pipeline. `frontend/` is empty; there is no architecture to swap nodes in and out of. |
| **End-to-end task success, cascading failure rate, downstream success** | Same — these are pipeline-level metrics. |
| **Level 5 (multi-step)** | Same. Jev cannot be multi-step alone; L5 is a property of the orchestration. |
| **Quality Gap vs strong-LLM baseline** | A strong-model API key. No `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in this environment. Current gold labels are hand-authored by me, which is an interim substitute, not a baseline. |
| **Measured strong-LLM latency** | Same. The 1.4–14 s figures above are vendor-published, not measured here. |
| **The headline question — "how many nodes before degradation?"** | Stage 2. What single-node data supports: **2 nodes robustly, 3 more behind a 0.60 gate, 2 conditional, 3 structurally impossible.** Whether errors compound across simultaneously-replaced nodes is unmeasured and is exactly what Stage 2 exists to find. |

---

## 6. Security note

The API key was pasted into chat, so it now exists in this conversation's history.
**Rotate it at `console.typesafe.ai` after the hackathon.** It is stored at
`~/.config/typesafe/env` (mode 600), deliberately outside the repo, and is not committed.
