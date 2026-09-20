# Jev Replacement Map — your agent architecture

Measured against the two architecture diagrams, 2026-09-19. Supersedes the node table in
[`jev-findings-v1.md`](./jev-findings-v1.md) §3, which used the spec's generic node list
and bare `noul` questions. Harness: `backend/probes/cases_v2.py` + `p07_architecture.py`.

21 cases · 134 judgments per rep · 3 reps · L1–L4 · ~$0.002.

---

## The answer

**7 of the 10 boxes can run on Jev. 1 must not. 3 never can.**

```
user request
  → agent A · task assignment          ✗ KEEP ON STRONG MODEL  0.71
      ├ agent 1 · info grabbing          ── split, see below
      │    ├ what to research            ✓ JEV  1.00
      │    ├ enough research yet?        ✓ JEV  1.00
      │    ├ retrieval itself            ✗ IMPOSSIBLE (no tools)
      │    └ image generation            ✗ IMPOSSIBLE (generative)
      ├ agent 2 · component decision    ✓ JEV  0.84, gate at L3
      │    └ skeleton render             ✗ IMPOSSIBLE (generative)
      ├ agent 3 · styling component      ✗ IMPOSSIBLE as value production
      └ JEV/LLM context of skeleton     ✓ JEV  1.00  ← best result in the suite
  Execution fan-out
      ├ Make UI                          ✗ IMPOSSIBLE (generative)
      ├ Perform functional action       ✓ JEV  0.90, gate
      └ Update setting                  ✓ JEV  0.81, criteria-sensitive
  to-do from llm                        ✓ JEV  0.92, gate
```

## The finding that contradicts the diagram

**`agent A — task assignment JEV` is the one node marked JEV that most needs a strong
model.** It scored **0.71 per-judgment and failed at every difficulty level, including
L1**, and adding the `criteria` field made it worse, not better. The failure has two
distinct shapes:

| Level | Shape | Example |
|---|---|---|
| L1–L2 | **over-invokes** | `button-color` → also fired `agent1_info`. Precision 0.50. |
| L2 | **inverts completely** | `hero-image` → P=0.00, R=0.00. Fired research, missed component. |
| L3 | **under-invokes** | `live-dashboard`, `profile-page` → recall 0.60. Silently dropped whole agents. |

L3 under-invocation is the dangerous one: routing failures are not visible as errors, they
are visible as *work that never happened*. And this node sits at the top of the graph, so
every mistake is a cascading failure by construction.

Everything downstream of agent A depends on it being right, and it is the weakest node
measured. **Recommendation: keep task assignment on the strong model, run everything below
it on Jev.** You pay one strong-model call per request and get Jev latency for the entire
rest of the graph.

## `agent 1 — info grabbing JEV` conflates two different jobs

Jev can decide *what* to research. It cannot *do* research — it has no tools and reads
only the state you hand it. Split the box:

| Half | Verdict | Measured |
|---|---|---|
| Deciding what to investigate | ✓ Jev | **1.00** — perfect relevance and prioritisation over 12 candidates |
| Deciding whether enough is known | ✓ Jev | **1.00** — both "stop" and "keep going" cases correct |
| Actually retrieving it | ✗ Impossible | no tool use |

This is the highest-leverage latency win in the graph. Unnecessary research is pure added
seconds, and Jev decides whether to skip it in ~190 ms with perfect accuracy on these cases.

## `LLM Gain Context` — your best node

The box highlighted in blue on diagram 2 is the strongest result in the whole suite:
**precision 1.00 and recall 1.00 at both 10 and 20 candidate items**, ~206 ms.

This corrects a v1 finding. The first pass measured 0.86–0.89 recall and I attributed a
"conservative bias" to Jev. It was my under-specified question — the API documents a
`criteria: {true, false}` field the harness was not using. Supplied properly, the node is
perfect. Inclusion bias is a **dial you set**, not a property you inherit.

## Caveat: `criteria` is a dial, and it cuts both ways

Do not read "always add criteria" as the lesson. `Update Setting` scored **1.00 with bare
nouls in v1 and 0.81 in v2** — my v2 wording ("explicitly or necessarily requires this
*exact* setting to change") made it under-trigger on implicit requests like *"make it
quieter but don't change how it looks"* (recall 0.25).

Criteria wording moves the operating point. It must be tuned per node against labelled
cases, not written once and trusted.

## The confidence gate holds

Every Component Decision failure landed below 0.60 confidence — `5-opts-2-visible` at
**0.31**, `rate-satisfaction` at **0.39**. The gate continues to catch exactly the cases
that need catching, now on a fresh case set it was not fitted to.

Independent support: a teacher model (`claude -p`, Sonnet) graded the v1 choice cases
blind to confidence. **87% agreement with Jev, mean rubric 3.60/4**, and the only two
disagreements were the only two cases below the gate. It also audited the gold labels and
found 14/15 sound.

## Decision quality — the Quality Gap

Latency is only half the question. A strong model (`claude -p`, Sonnet) re-decided every
multi-label case from the same state, blind to Jev's answers, then rated Jev's answer 0–4
and audited my gold labels. Quality Gap = teacher F1 − Jev F1 against gold.

| Node | Jev F1 | Teacher F1 | **Quality gap** | Rubric | Jev≈teacher |
|---|---|---|---|---|---|
| Research Strategy | 1.00 | 1.00 | **+0.00** | 4.00 | 1.00 |
| Research Stop | 1.00 | 1.00 | **+0.00** | 4.00 | 1.00 |
| LLM Gain Context | 1.00 | 1.00 | **+0.00** | 4.00 | 1.00 |
| Update Setting | 0.80 | 0.80 | **+0.00** | 4.00 | 1.00 |
| to-do Decomposition | 0.93 | 1.00 | +0.07 | 3.00 | 0.93 |
| **A: Task Assignment** | **0.61** | **0.81** | **+0.20** | **2.29** | **0.54** |
| **Overall** | 0.787 | 0.881 | **+0.094** | 3.19 | 0.795 |

**On four of six nodes the gap is exactly zero** — Jev's decision is not merely acceptable,
it is the same decision the strong model made, at ~195 ms instead of seconds. On those
nodes there is no quality argument for the strong model at all.

`Update Setting` deserves a note: Jev and the teacher agreed **perfectly** (1.00) and both
scored 0.80 — because **my gold label was wrong**, not because either model erred. The
teacher flagged `quiet-not-dark` as `too_wide`. Its real quality is higher than 0.80.

### Task Assignment is the only node with a real gap

Gap +0.20, rubric **2.29/4** (the spec's "partially correct, downstream correction
required"), and — the gold-independent number — Jev and the teacher **agree only 54% of
the time** on routing. Two models disagreeing half the time on the same routing decision is
the finding; it does not depend on my labels being right.

This independently confirms keeping `agent A` on the strong model. It was the conclusion I
reached from my own gold, which is exactly the kind of conclusion that needs an outside
check — and it survived one.

### The audit caught me being wrong

The teacher judged **13/16** of my gold labels sound and rejected three, all `too_wide`,
all mine:

| Case | Verdict | What I got wrong |
|---|---|---|
| `hero-image` | too_wide | `agent3_styling` — a new banner is not a change to existing styling |
| `live-dashboard` | too_wide | same — a new dashboard has nothing to restyle |
| `quiet-not-dark` | too_wide | `push`/`email`/`digest` wrongly included |

My labels skew over-inclusive, which means **part of what I earlier called Jev
"under-invoking" at L3 was my own over-labelling.** Corrected for that, Task Assignment
still fails — the 0.54 agreement is independent of gold — but the effect is smaller than
§"The finding that contradicts the diagram" states, and that section should be read with
this correction alongside it.

### Caveat on the teacher

On `profile-page` the teacher scored F1 **0.00** — a completely disjoint selection — which
is almost certainly a teacher failure rather than a strong model genuinely believing a
profile settings page needs none of those agents. I have **not** counted this as "Jev beat
the strong model." One bad row in sixteen is a reminder that the teacher is a noisy
instrument, single-pass and unreplicated, and that teacher and judge share a model family
and so cannot catch a bias they share.

## Latency

All node p50s now land **145–319 ms**, median ~195 ms. The v1 figures (305–603 ms) were
inflated by a TLS handshake per call — the client now reuses connections, which removed
260 ms (63%). Hold a warm connection open before the demo.

Per-request cost is ~$0.00003. The entire 21-case suite costs a fifth of a cent.

## What remains unmeasured

- **Multi-node compounding.** Every number here is single-node. Whether a 0.92 and a 0.81
  node in series produce 0.74 end-to-end is unknown and needs the pipeline.
- **Strong-model latency**, never measured here — no key. Vendor-published figures only.
- **`Perform functional action` at L4** and the parameter-enumerability boundary
  ("until tomorrow" works only because a `snooze` option existed; a *duration* cannot be
  emitted).
- **Task Assignment with fewer targets.** It was asked about 7 agents at once. Whether a
  binary tree of 2–3 way decisions recovers it is the obvious next experiment, and would
  be worth running before accepting a strong model at the top of the graph.
