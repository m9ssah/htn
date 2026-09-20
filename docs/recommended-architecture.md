# Recommended architecture

Derived from measurement, not preference. Every claim traces to
[`jev-replacement-map.md`](./jev-replacement-map.md) or
[`jev-findings-v1.md`](./jev-findings-v1.md).

---

## The shape

```
user request
   │
   ├──────────────► STRONG MODEL ── task assignment ────┐   ~1.4s
   │                (gap +0.20, agreement 0.54)         │
   │                                                    ▼
   └──────────────► JEV ── ONE batched call ────────► execute
                    every downstream judgment          ~195ms
                    asked speculatively, in parallel
```

Two calls, issued **at the same instant**, not in sequence. Total ≈ 1.4 s, not 1.6 s.

## Why one Jev call and not five

Your diagram has Jev at agent A, agent 1 and agent 2 — three sequential hops. Measured,
that is the wrong shape:

| Measured | Consequence |
|---|---|
| 1 question = 381 ms, 32 questions = 362 ms | **Questions are free.** Latency is flat. |
| 3 options = 374 ms, 200 options = 366 ms | **Options are free.** |
| Only state size costs (1 KiB 366 ms → 128 KiB 948 ms) | Keep state small; that is the only dial. |
| 64 questions verified in one request | Room for every judgment at once. |

Three sequential Jev hops cost ~585 ms. One batched call answering all of them costs
~195 ms — **3× faster for identical output**. Ask every downstream judgment speculatively,
including ones for branches the router may not take, and discard what you don't use. The
wasted questions are free.

That is the single biggest latency win available, and it is not in the current diagram.

## What goes where

```
STRONG MODEL   task assignment            only node with a real gap (2.29/4)

JEV, gap 0.00  what to research           1.00  ── no quality loss at all
               enough research yet?       1.00
               context selection          1.00      ← your best node
               update setting             1.00*     (*gold was wrong, not the model)

JEV + gate     component decision         0.84  ── failures land under 0.60 conf
               functional action          0.90
               to-do decomposition        0.92

NEVER JEV      retrieval (no tools)   ·  image gen  ·  skeleton render
               make UI  ·  styling as CSS/hex values      all generative
```

## Rules that fall out of the measurements

1. **Hold a warm connection open.** A fresh TLS handshake per call costs 260 ms — 63% of
   naive latency. Warm: p50 152 ms, p95 210 ms. Cold: p50 412 ms. Pre-warm before a demo.
2. **Batch into one call.** See above.
3. **Keep state under ~10 K tokens.** It is the only thing that costs latency. Hard
   ceiling ~32,700.
4. **Always supply `criteria: {true, false}`** on nouls — *and tune the wording per node
   against labelled cases*. It took context selection 0.89 → 1.00 recall, and took update
   setting the other way when worded too strictly. It is a dial, not a switch.
5. **Always include a no-match option** (`other`, `unclear`) in a Choice. Jev cannot pick
   an option you did not give it, and no-match probability is itself an escalation signal.
6. **Split meta-judgments into state-reading questions.** "Is the information sufficient?"
   scored 0.25. "Does `open_questions` record any unresolved question?" scored 0.03/0.98
   correctly. Same judgment, 4× the accuracy.
7. **Gate at 0.60**, escalating to the strong model below it (your call — see cost below).

## The escalation cost you accepted

You chose strong-model escalation over WAIT/clarify. Honest accounting:

```
above gate (74%)   STT → Jev 195ms → render           ~400ms   ✓
below gate (26%)   STT → Jev 195ms → strong 1.4-1.8s  ~2-3s    ✗ over the 1.5s target
```

For the product this is right — quality over speed on a quarter of turns. For the
hackathon demo at `plan-v1.md:75` (1.5 s from last word, 3× running), roughly one rehearsal
run in four will visibly miss. Consider WAIT/clarify **for the demo path only**, and keep
escalation in the product.

## The one experiment that would remove the strong call

Task assignment is the only thing forcing a slow model into the hot path. It has **not**
been tested in the form most likely to work:

- It was asked about **7 agents in a single question set**. A binary tree of 2–3 way
  decisions may recover it — every other node improved when its question was decomposed.
- **Its confidence separation was never measured.** The 0.60 gate was validated on
  `choice` confidence only. If Task Assignment's confidence separates as cleanly as
  Component Decision's did, you gate it instead of replacing it: Jev routes the confident
  majority, the strong model handles the rest, and the 1.4 s call leaves the common path.

Run that before accepting a strong model at the top of the graph. It is ~1 hour of work
and worth roughly 1.2 s on every request.

## What is still unmeasured

- **Multi-node compounding.** Every number is single-node. Whether 0.92 and 0.81 in series
  give 0.74 end-to-end needs the pipeline, which does not exist yet.
- **Strong-model latency.** Never measured here — no key. The 1.4–1.8 s figures are
  vendor-published.
- **Teacher reliability.** Single-pass, unreplicated, and it shares a model family with
  the judge, so it cannot catch a bias they share. One of sixteen rows was clearly bad.
