# Full architecture — both diagrams merged, end to end

Every box from diagram 1 and diagram 2, with its assignment and the evidence.
Legend: **J** = Jev · **S** = strong model · **C** = plain code, no model · **G** = gated on confidence ≥ 0.60

---

## Stage 1 — Decision layer (one Jev call)

```
                          user request
                               │
                               ▼
    ┌──────────────────────────────────────────────────────────┐
    │  JEV · ONE BATCHED CALL · ~200-350ms · ~$0.00003         │
    │                                                          │
    │  routing     which agents/paths are needed?          G   │
    │  research    which candidates must be investigated?  ✓   │
    │              does the candidate list cover this?     ✓   │
    │              do we already know enough to decide?    ✓   │
    │  component   which UI component?                     G   │
    │  skeleton    which template from the library?        G   │
    │  styling     which palette/font/density/radius?      G   │
    │  action      which functional action + which params? G   │
    │  settings    which settings must change?             ✓   │
    │  context     which facts go to the strong model?     ✓   │
    │  meta        does any of this require generation?    ✓   │
    └──────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
    all ≥0.60, nothing generative        generative OR any <0.60
              │                                 │
              │                                 ▼
              │              ┌──────────────────────────────────┐
              │              │ STRONG MODEL · one call · ~1.5s  │
              │              │ fed ONLY Jev's selected context  │
              │              │ writes: markup, CSS values,      │
              │              │ hex codes, copy, to-do lists,    │
              │              │ research candidates on a miss    │
              │              └──────────────────────────────────┘
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                         Stage 2: execute
```

## Stage 2 — Execution fan-out (the bottom half)

Every box here is **two** things: a decision made by a model, and an execution done by
code. They are separated on purpose — no model ever writes to the DOM.

```
                        DECIDE  (model)          DO  (code, no model)
   ┌──────────────────────────────────────┬──────────────────────────────┐
   │ Make UI      which skeleton?   J+G   │  fill the template           │
   │              markup / copy      S    │  insert the nodes            │
   ├──────────────────────────────────────┼──────────────────────────────┤
   │ Functional   which action?     J+G   │  call the handler            │
   │   Action     which params?      J    │  pass the args               │
   │              (only if enumerable)    │                              │
   ├──────────────────────────────────────┼──────────────────────────────┤
   │ Update       which settings?    J    │  write to the store          │
   │   Setting                    1.00    │                              │
   ├──────────────────────────────────────┼──────────────────────────────┤
   │ image gen    the prompt         S    │  insert the <img>            │
   └──────────────────────────────────────┴──────────────┬───────────────┘
                                                         ▼
                            ┌────────────────────────────────────────┐
                            │  WHITELIST VALIDATION            C     │
                            │  reject malformed / out-of-scope       │
                            │  payloads  ← plan-v1.md:98, step 21    │
                            └────────────────────┬───────────────────┘
                                                 ▼
                                  Touch the component            C
                                  the actual DOM mutation
```

**Two guards, because there are two failure modes.** The confidence gate catches a *wrong
decision* (Jev picked the wrong component). The whitelist catches a *malformed payload* —
and no confidence score can catch that one, because Jev can be 0.99 confident and still
name a region that no longer exists.

Consequence worth having: everything below the whitelist is deterministic and testable
with hand-written payloads, no API calls involved.

## Stage 3 — The two loops

```
  to-do loop                          skeleton→context loop
  ──────────                          ─────────────────────
  S writes candidate steps            J picks skeleton from library
        │                                   │
        ▼                                   ▼
  J filters: required? 0.92           C renders it (minimal info)
        │                                   │
        ▼                                   ▼
  C executes each in order            J selects context of the
        │                             chosen skeleton  1.00
        └──► back to Functional Action      │
             (one pass per item)            └──► feeds the strong call
```

Both loops matter for a different reason: the **to-do loop** is where Jev keeps a slow
model from re-deciding on every step, and the **skeleton→context loop** is where Jev
shrinks what the slow model has to read.

---

## Every box, assigned

| Box (from your diagrams) | Assign | Measured | Note |
|---|---|---|---|
| user request | — | — | |
| agent A · task assignment | **S** | 0.54 agreement, rubric 2.29/4 | only real quality gap; gate-test first |
| agent 1 · what to research | **J** | 1.00 | |
| agent 1 · list sufficient? | **J** | 0.06 on an inadequate list | **new box** — add it |
| agent 1 · enough known yet? | **J** | 1.00 | kills unnecessary research |
| agent 1 · retrieval | **C** | — | no tools; this is code |
| agent 2 · component decision | **J+G** | 0.84 | failures all <0.60 conf |
| agent 3 · styling | **J+G** iff enumerated | token space per `plan-v1.md:79` | else **S** |
| skeleton render · choose | **J+G** | selection ≠ generation | **make the library enumerable** |
| skeleton render · draw | **C** | — | template fill |
| image generation | **S** | — | generative |
| JEV/LLM context of skeleton | **J** | **1.00 @ 20 items** | best node; move it *before* the strong call |
| Execution | **C** | — | orchestration |
| Make UI · markup | **S** | — | generative |
| Perform functional action · which | **J+G** | 0.90 | |
| Perform functional action · params | **J** iff enumerable | "until tomorrow" ✓ only because `snooze` existed | a *duration* cannot be emitted |
| Update setting | **J** | 1.00 | perfect scope discipline |
| to-do from llm · write list | **S** | — | generative |
| to-do from llm · filter list | **J** | 0.92 | |
| whitelist validation | **C** | — | `plan-v1.md:98` |
| Touch the component | **C** | — | the mutation itself |

## Latency budget

```
  fast path   (most turns)   Jev 200-350ms → validate → mutate      ~250-400ms
  slow path   (generative
               or <0.60)     Jev 200-350ms → strong 1.4-1.8s        ~1.6-2.1s
```

The fast path only exists if task assignment is gated rather than delegated to the strong
model. **That single unrun experiment is the difference between ~250 ms and ~1.6 s on the
common path**, and it is why it is the top of the backlog.

## Build order

1. **Gate-test task assignment** (~1h). Decompose 7-way routing into 2–3 way decisions;
   measure confidence separation. Decides whether the strong model sits in the hot path.
2. **Enumerate the skeleton library and the token space.** Biggest coverage gain, and it
   is a product decision rather than a model one.
3. **Build the decision layer as one call.** Not six hops — the whole point.
4. **Wire context selection ahead of the strong call**, not beside it.
5. **Add the list-sufficiency noul.** Free, and it is the only thing standing between you
   and confidently filtering a list that never contained what mattered.

## Still unmeasured

Every number above is single-node. Multi-node compounding — whether 0.92 and 0.84 in
series give 0.77 end to end — needs a running pipeline, and `frontend/` is empty.
