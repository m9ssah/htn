# Jev replacement benchmark — plan v2 (adapted to Jev's actual shape)

Supersedes the framing in the original request, preserved verbatim as
[`jev-benchmark-spec-original.md`](./jev-benchmark-spec-original.md). The structure, difficulty ladder,
rubric and metrics are kept; what changes is **which nodes are testable at all**, because
Jev turned out to be a typed judgment model rather than a fast LLM. Evidence for every
claim: [`jev-findings-v1.md`](./jev-findings-v1.md).

---

## The one structural change

The original plan asks, for each of ten nodes: *baseline `Strong→Strong→Strong`* vs
*treatment `Strong→Jev→Strong`*. That substitution is only well-formed when the node's
output is a choice over an enumerated set. Jev emits probabilities over options you
supply — never text, markup, or values.

So every node is first classified, and only then tested:

```
             node output is...
                    |
     +--------------+--------------+
     |                             |
 enumerable                   generative
     |                             |
 SUBSTITUTE                   Jev cannot be the node
 Strong -> Jev -> Strong           |
     |                   +---------+---------+
     |                   |                   |
 gate at conf 0.60   GATE upstream      VALIDATE downstream
                     "is research      "does the output
                      needed at all?"   satisfy the constraint?"
```

The third column is the part worth keeping from the original spec that has no place in a
substitution benchmark — and it is where a lot of the latency win actually lives, because
a Jev gate that skips an unnecessary research step saves the *whole* step, not a fraction
of one node.

---

## Stage 1 — single-node (partially complete)

**Done:** 34 gold-labelled cases × 3 reps across 9 node roles, L1–L4, plus an 8-rep
stability and escalation sweep. Results in `jev-findings-v1.md` §3.

**Still to run, in priority order:**

0. **Validate the confidence gate on `noul` questions.** The 0.60 threshold was measured
   on `choice` confidence only. Nouls return a bare probability and no confidence field,
   so the harness derives one (`|p − 0.5| × 2`) that has never been tested. Both
   conditional nodes are noul-based — the gate is unvalidated exactly where it is most
   needed. Do this before anything else, because every item below assumes gating works.
1. **Re-run every weak node with decomposed questions.** §4 of the findings shows a
   judgment scoring 0.25 as a vague meta-question and 0.98 when decomposed into
   state-reading questions. Until a node has been tried both ways, a low score does not
   mean Jev can't do it. Priority: `Research Stop` (0.64, and the highest-latency-leverage
   node), then `Styling` (0.56), then `Task Assignment` (0.86).
2. **Task Assignment, decomposed.** Current form asks 7 simultaneous "is this node
   needed?" nouls and recall falls to 0.67 at L3. Test whether per-node questions carrying
   the *dependency* explicitly ("does this request change stored state?" rather than "is
   `functional_action` required?") recovers recall.
3. **Context Selection at 30 and 50 items.** Precision held at 1.00 and recall at
   0.86–0.89 across pools of 10/15/20 — extend to confirm the flat trend, since the
   original spec specifically asks for 10 → 20 → 30 → 50+.
4. **Functional Action parameter boundary.** The finding to sharpen: an action is
   expressible iff its parameter space is enumerable *in advance*. "Disable push, keep
   email" = 2 nouls. "Until tomorrow" worked only because `snooze_temporary` was an option
   — an actual duration cannot be emitted. Build cases that walk that boundary.

**Blocked:** Quality Gap and measured latency reduction, both of which need a strong-model
key. Hand-authored gold labels are standing in for the baseline.

---

## Stage 2 — multi-node (blocked, and this is the headline)

**Cannot start.** `frontend/` is empty; there is no pipeline to swap nodes in. Every
C0–C7 configuration, end-to-end success, cascading-failure rate and Level 5 depends on it.

What Stage 1 licenses as the *hypothesis* Stage 2 must test:

| Config | Jev nodes | Predicted | Risk being measured |
|---|---|---|---|
| C0 | none | baseline | — |
| C1 | Component Decision | no loss | — |
| C2 | + Settings Update | no loss | — |
| C3 | + Functional Action (gated) | no loss | first gate in the path |
| C4 | + Context Selection | small loss | under-inclusion starves the executor |
| C5 | + Task Assignment (gated) | degrades | recall 0.67 at L3 drops whole steps |
| C6 | + Research Strategy / Decomposition as filters | unknown | two gates compounding |
| C7 | everything expressible | n/a | 3 nodes are structurally impossible — C7 as originally written cannot exist |

The one thing single-node data genuinely cannot predict is **whether a conservative bias
compounds**. Context Selection under-includes slightly and Task Assignment under-routes
slightly; both are individually safe, and they may or may not multiply into a pipeline
that quietly does less than asked. That is the real content of Stage 2.

---

## Rubric and metrics — what changes

Keep the 0–4 scale and every primary/secondary metric from the original spec. Three
additions, all justified by measurement:

1. **Record the full probability distribution and confidence on every case, not the
   argmax.** L4 cases have several defensible answers, so the score is probability mass on
   the acceptable set. Already implemented in `backend/probes/p03_node_suitability.py`.
2. **Report exact-match and per-judgment accuracy separately.** For multi-label nodes they
   diverge hard — Task Assignment is 20% exact and 0.86 per-judgment. One number alone
   misleads in either direction.
3. **Add "escalation rate at T=0.60" as a primary metric.** It is the number that actually
   answers the research question, since coverage is a threshold choice rather than a fixed
   node list.

**Drop** "Quality maintained per unit of latency reduction" as the headline ratio. Latency
is near-constant at ~350 ms regardless of question count or option count, so the tradeoff
is not continuous — the real lever is *how much state* you send and *how many calls* you
make, not how hard the question is.

---

## Failure taxonomy — observed so far

Of the original 17 categories, these fired in measurement:

| # | Category | Where observed |
|---|---|---|
| 1 | Wrong routing | Task Assignment L1 — spurious `component_decision` on a pure toggle |
| 6 | Missing critical context | Context Selection — consistent single-item under-inclusion |
| 11 | Missing dependency | Task Assignment L3 — dropped `styling` and `functional_action` |
| 15 | Failure to resolve ambiguity | Functional Action L4 — `other` at conf 0.34 |
| 16 | Failure to recognise uncertainty | **Not observed.** The inverse held: confidence tracked correctness, max 0.55 on any wrong answer. |

Categories 2–5, 7–10, 12–14 and 17 need the pipeline or the re-runs above before they can
fire. **#16 not firing is the load-bearing result** — the entire hybrid architecture rests
on Jev knowing when it doesn't know, and on this evidence it does.

---

## Hybrid / escalation architecture — validated, ready to build

This was the last item in the original spec. It is the one part already answered, so it
should move to the front of the build:

```
request --> Jev, one batched call (~370ms, all questions at once)
                 |
        confidence >= 0.60 ?
          |              |
         yes             no  (26% of decisions)
          |              |
        act        strong model
     (100% acc)     (the hard 26%)
```

Build notes from measurement:

- **Batch aggressively.** 32 questions cost the same as 1. Ask every judgment the turn
  needs in a single call rather than one call per node.
- **Keep state small.** It is the only thing that costs latency: 1 KiB → 366 ms,
  128 KiB → 948 ms. Stay under ~10 K tokens to protect the demo budget.
- **Gate at 0.60, not 0.70.** 0.70 escalates 6% more for zero accuracy gain.
- **Always include a no-match option** (`other`, `unclear`) in a Choice. Jev cannot pick an
  option you did not give it, and the no-match probability is itself an escalation signal.
- **Split every meta-judgment into state-reading questions.** This was worth more than any
  other change measured: 0.25 → 0.98 on the same underlying judgment.

---

## Running it

```bash
python3 backend/probes/p01_hard_limits.py       # structural limits
python3 backend/probes/p02_scaling.py           # latency scaling, token ceiling
python3 backend/probes/p03_node_suitability.py  # the node map
python3 backend/probes/p04_escalation.py        # confidence gate + stability
```

Key is read from `TYPESAFE_API_KEY` or `~/.config/typesafe/env`. Every probe is bounded by
a request and USD cap in `backend/jev/client.py`. The full suite above costs about $0.02.
