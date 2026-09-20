# Latency evaluation — method, changes, and what they cost in accuracy

> The goal was never "make it fast." It was **make it fast without paying for it
> in decision quality**, and be able to prove which of those two we traded on
> each time. This document records the measurements, the five changes we shipped
> off them, and the three things we measured and could *not* fix.

---

## 1. The result, first

Two groups, because the proof that quality survived is a *different* argument for
each.

### Group A — transport changes: quality unchanged by construction

Same request bytes, same model, same response. Only the wire differs, so there is
nothing to re-measure.

| change | latency | accuracy |
|---|---|---|
| TLS connection reuse | **412 → 152ms** p50 per Jev call | identical response |
| strip the agent harness from the content call | **5369 → 1605ms** to first token | same model, same task prompt |

### Group B — decision changes: quality re-measured after every one

| change | latency | accuracy |
|---|---|---|
| batch every judgment into one Jev call | ~585 → **214ms** p50 | 8/8 schema-valid, 8/8 template correct (p14) |
| give every `noul` explicit true/false criteria | 224 → **193ms** p50 | **0.95 → 1.00** (p06) |
| reword + re-threshold the research gate | 3386 → **1976ms** mean | **12/15 → 14/15**, false alarms **3 → 0** (p15) |

The last two moved *both* numbers the right way. That is not a trade we engineered;
it is what happened when an under-specified question was specified properly — a
model that is sure faster is also a model that is sure correctly.

---

## 2. Method

**Harness.** `backend/probes/p01`–`p17`, stdlib-only Python, one client
(`backend/jev/client.py`) with a hard request cap and a hard dollar cap so a runaway
loop cannot spend the budget. The key lives at `~/.config/typesafe/env`, mode 600,
outside the repo and never committed.

**Repetitions.** 3–8 per row. Where a cache or a warm connection could confound a
result, cold and warm runs are reported separately rather than averaged together —
probe 17 does this explicitly, because the cold/warm delta *is* the finding.

**Gold sets.** Every accuracy number is against a hand-labelled expected answer,
not against the model's own confidence. A separate teacher model (`teacher.py`)
independently graded Jev's choices on a 0–4 rubric so that "good" was not defined
by the thing being tested.

**Ground truth for the shape of the system.** Templates, slots and style axes were
extracted from `packages/schema/src/index.ts` rather than restated, so the probes
test the contract the renderer actually enforces.

### How we knew where to cut

The decisive measurement was not a latency number, it was a *zero*:

```
message_start ──► first text_delta   =   0–1ms,  in all 16 runs
```

The API does not open the stream until it is ready to emit. So there is no "model
thinking" phase to optimise — **every millisecond of time-to-first-token is spent
upstream of the model**, in request assembly and prefill. That is what told us to
attack prompt weight and connection setup, and it is why streaming was *not* the
lever we first assumed it was.

The second structural finding, from probe 2:

| dimension | p50 |
|---|---|
| 1 question | 381ms |
| 32 questions | 362ms |
| 64 questions | 518ms |
| 3 options | 374ms |
| 200 options | 366ms |
| ~1 KiB state | 366ms |
| ~32 KiB state | 439ms |
| ~128 KiB state | 948ms |

**Questions are free. Options are free. Only the state you send costs time.**
That single table is why the architecture is one wide batched call instead of a
tree of small ones — the tree pays a round trip per hop for information the wide
call gets for nothing.

---

## 3. The five changes, in detail

**1 · Reuse the TLS connection.** A fresh handshake per call cost ~260ms — **63% of
the observed per-call latency was handshake, not inference.** Pooling one connection
took the p50 from 412ms to 152ms. `jev/client.py:95`.

**2 · Batch every judgment into one call.** Because questions are free, all eight
decisions — template, five style axes, research gate, generation gate — are asked
speculatively in a single request, including ones whose answers may go unused. Eight
questions, 214ms p50, versus roughly 585ms for a hop-by-hop tree that returns *less*
information. Verified end-to-end at 8/8 schema-valid and 8/8 template-correct (p14).

**3 · Specify every `noul` question.** The `criteria: {true, false}` field is
optional and we were not using it. Supplying it took context selection from
P 1.00 / R 0.89 to **P 1.00 / R 1.00**, and the p50 *down* from 224ms to 193ms.
Wording turned out to be the single largest variable we tested — across the
research-gate sweep it moved accuracy by 0.33 and mean latency by 3.2×, more than
any architectural change.

**4 · Reword and re-threshold the research gate.** The original phrasing fired the
slow research path on 3 of 15 utterances that did not need it. Four wordings were
tested, then a threshold sweep from 0.2 to 0.6:

| wording | correct | false alarms | missed | mean |
|---|---|---|---|---|
| w1 original | 12/15 | 3 | 0 | 3386ms |
| w2 session-scoped | 8/15 | 7 | 0 | 4795ms |
| **w3/w4 external-only, T = 0.40** | **14/15** | **0** | 1 | **1976ms** |

The winning criterion turns on *"anything that changes independently of this
device"* rather than "external or stored" — prices, weather, opening hours, recalls.

*Honest about this one:* the set is 15 utterances, and **T = 0.40 was chosen on the
same 15 it was scored on.** The wording sweep and the threshold sweep are sound
method; the specific constant is a demo-time choice, not a validated one. It should
be re-picked against held-out utterances before anyone treats 0.40 as a fact.

**5 · Strip the content call down to the task.** The agent harness around the
content model was carrying **21,009 input tokens against the task's 922 — 23× the
payload for identical work.** Removing tool definitions, MCP servers and the default
system prompt took time-to-first-token from 5369ms to 1605ms, on the same model with
the same task. Of the remaining 1605ms, ~570ms is process spawn that an in-process
agent does not pay, putting the real floor near 1s.

---

## 4. What we measured and could not fix

Five wins are only credible next to the misses.

**Confidence does not separate right from wrong.** On the real template set, the one
wrong answer (`"text them the recipe"` → `people_picker`) came back at **0.723**,
while a *correct* answer came back at **0.317**. There is no threshold that keeps the
good one and drops the bad one. Any confidence gate has to be calibrated per node,
and `templateId` currently has none.

**Content latency did not come down to target.** The 1.5s budget is met by the
skeleton, not by the content. `recipe_overview` has 13 slots arriving ~380ms apart;
the first lands near 1.2s and the last near 6–8s. Streaming redistributes *when*
slots fill — it does not reduce when content starts, and probe 16 refuted our own
stated hypothesis on that point. The architecture survives this only because unfilled
slots shimmer at final dimensions rather than blocking the paint.

**Two nodes never cleared 0.80.** After criteria tuning, "which data to grab"
plateaued at F1 **0.79** and "which components must change" at **0.776**. Both stay
on the slow path or behind a gate; neither is claimed as replaced.

**One question type is invisible to the gate.** `"what wine goes well with this"`
scores **0.13** — it will never trigger research under any threshold we would ship,
because the gate cannot tell that a recommendation benefits from a lookup.

**Tail latency is not under our control.** One stripped-harness repetition returned
at 5039ms and one at 21s against a ~1.6s median. That is API-side variance, not
configuration, and the demo needs a fallback rather than a tuned average.

**Jev judges what it can see far better than what it must predict.** Filtering
fetched search results scores **1.00**; guessing in advance which sources to consult
scores **0.79**. The architecture leans on the first and hedges the second.

---

## 5. Reproducing it

```bash
cd backend
python3 probes/p02_scaling.py           # questions/options are free, state is not
python3 probes/p06_noul_criteria.py     # criteria: 0.95 -> 1.00, and faster
python3 probes/p15_research_gate.py     # wording sweep + threshold sweep
python3 probes/p17_ttft_decomposed.py   # where the 5.9s actually goes
```

Stdlib only, no install step. The client enforces both a request cap and a dollar
cap; the full 17-probe suite cost about **$0.09 in Jev calls**, most of the remaining
spend being the independent teacher model used for grading. Raw per-event timings for
the latency decomposition are in `backend/results/p17_raw/`.

Deep-dive on the time-to-first-token work: [`latency-findings.md`](./latency-findings.md).
