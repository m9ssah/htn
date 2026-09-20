# Architecture — final

Every assignment below is measured, not assumed. Probes 1–12, `backend/results/*.json`.

**Legend** · **J** Jev · **S** strong model · **C** code, no model · **G** gated at confidence ≥ 0.60

---

## The principle

> **Jev judges an enumerated space. It never produces one.**
> And it judges what it can *see* far better than what it must *predict*:
> filtering fetched results scored **1.00**; guessing which sources to fetch scored **0.79**.

So the division of labour is fixed: **the strong model generates, Jev judges, code executes.**
Coverage is a design choice — the more you enumerate, the more Jev owns.

---

## Stage 1 · Decision layer — one Jev call

```
                            user request
                                 │
                                 ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  JEV · ONE BATCHED CALL · ~200-350ms · ~$0.00003               │
   │  every enumerable judgment, asked speculatively and in parallel│
   │                                                                │
   │   routing     which paths are needed?                   G  ⚠   │
   │   research    which candidates must be investigated?    ✓ 1.00 │
   │               does the candidate list cover this?       ✓ 0.06 │
   │               do we already know enough?                ✓ 1.00 │
   │   UI          which layout / skeleton?                  ✓ 1.00 │
   │               which component?                          G 0.95 │
   │               which palette / font / density / radius?  G      │
   │   data        do we need to fetch anything?             ✓      │
   │   components  which components must change?             G 0.78 │
   │   context     which facts go to the strong model?       ✓ 1.00 │
   │   meta        does any of this require generation?      ✓      │
   └────────────────────────────────────────────────────────────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
   all ≥0.60, nothing generative           generative OR any <0.60
            │                                         │
            │                    ┌────────────────────▼──────────────┐
            │                    │ STRONG MODEL · one call · ~1.5s   │
            │                    │ fed ONLY Jev's selected context   │
            │                    │ writes: keywords, markup, CSS,    │
            │                    │ hex codes, copy, to-do lists,     │
            │                    │ research candidates on a miss     │
            │                    └────────────────────┬──────────────┘
            └────────────────────┬────────────────────┘
                                 ▼
```

## Stage 2 · Search & fetch loop — LLM generates, Jev judges

```
   need data?
       │
       ├─► S: keywords / queries        ~1.4s, ONCE, cached per request type
       │                                 (outside the loop)
       ▼
   C: run the search / fetch            no model
       │
       ▼
   ┌─────────────────────────────────────────────────┐
   │  J · one call over N results · ~250ms           │
   │    relevant?            per result       1.00   │
   │    current + authoritative?              0.89   │  ← keep these
   │    do the results conflict?              0.97   │     SEPARATE
   │    search again?                          3/3   │
   └─────────────────────────────────────────────────┘
       │
       ├─ enough ────► kept set → the answer
       └─ not enough ► loop (next query or next page)
```

Three rounds cost **1.4 s + 3×250 ms**, not 3×1.4 s. Never ask "is this relevant *and*
trustworthy" as one question — that conflation cost 0.50 precision in testing.

## Stage 3 · Execution — decide vs do

```
                      DECIDE  (model)            DO  (code, no model)
   ┌────────────────────────────────────────┬──────────────────────────┐
   │ Make UI     which skeleton?   J  1.00  │  fill the template       │
   │             markup / copy     S        │  insert the nodes        │
   ├────────────────────────────────────────┼──────────────────────────┤
   │ Grab data   see Stage 2       J  1.00  │  run the fetch           │
   ├────────────────────────────────────────┼──────────────────────────┤
   │ Update UI   which components  J+G 0.78 │  apply prop / visibility │
   │ components  must change?               │                          │
   ├────────────────────────────────────────┼──────────────────────────┤
   │ image gen   the prompt        S        │  insert the <img>        │
   └────────────────────────────────────────┴───────────┬──────────────┘
                                                        ▼
                         ┌──────────────────────────────────────────┐
                         │  WHITELIST VALIDATION               C    │
                         │  reject malformed / out-of-scope         │
                         │  payloads   ← plan-v1.md:98, step 21     │
                         └──────────────────┬───────────────────────┘
                                            ▼
                              Touch the component              C
```

**Two guards, two failure modes.** The confidence gate catches a wrong *decision*; the
whitelist catches a malformed *payload*. No confidence score catches the second — Jev can
be 0.99 confident and still name a region you deleted.

## Stage 4 · The to-do loop

```
   S writes candidate steps  ──►  J filters: required?  0.92  ──►  C executes in order
                                                                        │
                                          back to Stage 3, one pass per item
```

Keeps the slow model from re-deciding on every step.

---

## Every box, assigned

| Box | Who | Measured |
|---|---|---|
| agent A · task assignment | **S** ⚠ | 0.54 agreement, rubric 2.29/4 — see open risk |
| what to research | **J** | 1.00 |
| candidate list sufficient? | **J** | flags an inadequate list at 0.06 |
| enough known already? | **J** | 1.00 |
| research candidate list itself | **S** | generative |
| choose the UI / skeleton | **J** | **1.00**, conf 0.92–1.00 |
| component decision | **J+G** | 0.95 / 0.84 on constrained cases |
| styling | **J+G** iff token space enumerated | else **S** |
| grab data — which keywords | **S** | generative, cached |
| grab data — which results matter | **J** | **1.00** |
| conflict / recency detection | **J** | 0.97 / 0.89 |
| search again? | **J** | 3/3 |
| context selection | **J** | **1.00 @ 20 items** |
| update UI components | **J+G** | 0.78 — weakest live node |
| to-do list — write it | **S** | generative |
| to-do list — filter it | **J** | 0.92 |
| markup, CSS values, hex, copy | **S** | generative |
| image generation | **S** | generative |
| retrieval, template fill, validation, DOM mutation | **C** | no model |

## Latency

```
  fast path   J 200-350ms → validate → mutate                  ~250-400ms
  search path J 250ms × rounds (+ S 1.4s once, cached)         ~1.7s first, ~250ms after
  slow path   J 200-350ms → S 1.4-1.8s                         ~1.6-2.1s
```

Hold a **warm connection** — a fresh TLS handshake costs 260 ms, 63% of naive latency.
Warm p50 152 ms, p95 210 ms. Keep state under ~10 K tokens; it is the only thing that
costs latency. Hard ceiling ~32,700 input tokens.

## Rules that fall out of the measurements

1. **One wide call, not a tree of hops.** 1 question 381 ms, 32 questions 362 ms — questions
   are free. Three sequential hops cost ~585 ms for less information.
2. **Always supply `criteria: {true, false}` — and tune the wording per node.** Wording
   moved F1 by **0.44**, more than any other variable tested. It is a dial, not a switch:
   over-tight wording cost recall 0.24; tuned recovered it to 1.00.
3. **One judgment per question.** Conflating "relevant" with "trustworthy" cost 0.50
   precision. Split them — it is free.
4. **Always include a no-match option** in a Choice. Jev cannot pick what you did not offer,
   and no-match probability is itself an escalation signal.
5. **Split meta-judgments into state-reading questions.** "Is the information sufficient?"
   scored 0.25; "does `open_questions` record anything unresolved?" scored correctly.
6. **Give Jev things to see, not things to predict.** Filtering fetched results 1.00 vs
   predicting sources 0.79. Same model, same node, different framing.
7. **Gate at 0.60.** No wrong answer in testing exceeded 0.55 confidence.

## Open risk — one experiment

`agent A · task assignment` is the only node with a real quality gap and it sits at the top,
forcing a 1.4 s call into the hot path. It has **not** been tested in the form most likely to
work: it was asked about **7 agents at once**, and every other node improved when its question
was decomposed. **Its confidence separation was never measured** — the 0.60 gate was validated
on `choice` questions only.

If it separates like the other nodes, you gate routing instead of replacing it and the strong
call leaves the common path: **~1.6 s → ~250 ms on most turns.** ~1 hour of work, highest
value remaining.

Second priority: reframe `update UI components` (0.78) as *"which components does the stated
task need?"* and hide the complement, rather than asking per-panel whether to hide it.

## Still unmeasured

Every number is single-node. Multi-node compounding — whether 0.92 and 0.78 in series give
0.72 end to end — needs a running pipeline, and `frontend/` is empty.
