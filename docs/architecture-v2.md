# Recommended architecture v2 — designed around what Jev actually is

Supersedes [`recommended-architecture.md`](./recommended-architecture.md), which mapped
Jev onto the existing diagram. This one changes the diagram. Evidence:
[`jev-replacement-map.md`](./jev-replacement-map.md), probes 1–9.

---

## The principle everything follows from

> **Jev judges an enumerated space. It never produces one.**
> Every node scoring 1.00 is a node where we handed it the options.

Which makes coverage a **design choice, not a model limitation**:

```
   how much you enumerate  ──►  how much Jev can own  ──►  how fast you are

   "pick a hex code"            generative    ✗ strong model, seconds
   "pick from 12 palettes"      enumerable    ✓ Jev, 195ms, conf-gated
```

`plan-v1.md:51` already found this edge — *"Jev handles your enumerated token space, but
it can't invent a hex code"* — and `plan-v1.md:79` already acts on it by enumerating
palettes, fonts, density, radius and contrast. **Generalise that move to every box.**

## The shape

Your diagrams are a tree of sequential agent hops. Jev's economics invert that: questions
are free and run in parallel, so a tree of small calls is strictly worse than one wide call.

```
user request
     │
     ▼
┌──────────────────────────────────────────────────┐
│  DECISION LAYER — one Jev call, ~200-350ms       │
│  every enumerable judgment, asked speculatively  │
│    routing · research needed? · list sufficient? │
│    component · style tokens · action · settings  │
│    which context to pass · does this need gen?   │
└──────────────────────────────────────────────────┘
     │
     ├─ all ≥0.60 conf, nothing generative ──► EXECUTE        ~250ms   (most turns)
     │
     └─ generative OR low confidence
              ▼
        STRONG MODEL, one call, receiving Jev's
        pre-selected minimal context ───────────► EXECUTE     ~1.5s
```

**Two calls, not six hops.** Ask every downstream question up front, including for branches
the routing may not take — the wasted ones are free. Measured: 1 question 381 ms,
32 questions 362 ms, 64 questions 518 ms (warm: ~200 ms / ~350 ms). A 40–60 question
decision layer costs ~350 ms; three sequential hops cost ~585 ms for less information.

## Your diagram, box by box

| Your box | Becomes | Evidence |
|---|---|---|
| agent A · task assignment **JEV** | **strong model** — or Jev-gated, pending one experiment | gap +0.20, agreement 0.54, rubric 2.29/4 |
| agent 1 · info grabbing **JEV** | **split**: Jev decides *what* + *whether enough* (1.00); retrieval is code, not a model | no tools |
| ↳ candidate list | **you author it, per domain** | tailored 1.00 vs universal 0.79 |
| ↳ list-sufficiency check | **add this box** — Jev flags an inadequate list at 0.06 | probe 9B |
| agent 2 · component decision **JEV** | **Jev**, gate at L3 | 0.84, failures all <0.60 conf |
| agent 3 · styling component | **Jev iff you enumerate the token space** | `plan-v1.md:79` already does |
| skeleton render (minimal info) | **Jev iff skeletons are a template library** | selection ≠ generation |
| image generation | strong model / image model | generative |
| JEV/LLM context of skeleton | **Jev, and move it BEFORE the strong call** | 1.00 — best node measured |
| Execution → Make UI | strong model | generative |
| Execution → functional action | **Jev**, gate | 0.90 |
| Execution → update setting | **Jev** | 1.00 (my gold was the error, not Jev) |
| to-do from llm | **Jev filters a candidate step list**; strong model writes the list | 0.92 |

## Three changes worth making

**1. Move `LLM Gain Context` before the strong model, not beside it.** In diagram 2 it
feeds Execution in parallel. It is your best node (precision 1.00, recall 1.00 at 20
items), and its real value is shrinking what the strong model has to read — which makes
the slow call both faster and cheaper. It should gate the strong call, not accompany it.

**2. Enumerate the skeleton space.** If `skeleton render` picks from a template library
rather than writing markup, it stops being generative and moves onto Jev at ~200 ms. This
is the single largest coverage gain available, and it is a product decision, not a model
one.

**3. Add the list-sufficiency check.** One extra noul, free, in a call you are already
making. It is what stops Jev confidently filtering a candidate list that never contained
the thing that mattered.

## The open risk

Task assignment sits at the top and is the only node with a real quality gap. It has not
been tested in the form most likely to work: it was asked about **7 agents at once**, and
every other node improved when its question was decomposed. **Its confidence separation
was never measured** — the 0.60 gate was validated on `choice` only.

If its confidence separates like Component Decision's did, you gate it instead of replacing
it, and the strong call leaves the common path entirely — taking the architecture from
~1.5 s to ~250 ms on most turns. That is ~1 hour of work and the highest-value experiment
remaining.

## Still unmeasured

Multi-node compounding. Every number is single-node; whether 0.92 and 0.84 in series give
0.77 end-to-end needs a pipeline that does not exist yet.
