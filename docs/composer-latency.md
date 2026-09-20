# `jevStructureComposer` latency — measured

Spike P20. 40 composes against the real Jev model: 32 back-to-back (4 demo
prompts × 2 repeats × 2 candidate pools × 2 cold processes) plus 8 with a 15s
pause between them, which is the demo's actual cadence. Raw per-event timings:
[`backend/results/p20_composer_latency.json`](../backend/results/p20_composer_latency.json).

**Verdict: no. A paintable structure cannot land in <250ms on this path, and the
first thing it yields is not safely paintable anyway.**

## What the API actually does

`experimental_composeSpec` does **not** stream incrementally. With no
`initialSpec` it takes the `composeBatch` path, which makes **exactly two**
serialized evaluator round trips and yields three events:

```
t0 ──[ select: 1 Jev call, 16 questions ]──► step  (flat tree, all children under root)
                                              │
                                   ──[ layout: 1 Jev call ]──► step (reparented) ─► complete
```

Local (non-network) work is negligible: **median 0.8ms, max 4.5ms** per compose.
Time-to-first-event *is* one Jev round trip. Nothing dribbles; there is no
per-element stream to paint against.

## The numbers (min / median / max, ms)

| | n | first event | first `complete` | <250ms |
|---|---|---|---|---|
| **15s gap between composes** | 8 | 341.6 / **471.2** / 646.7 | 426.3 / 608.8 / 860.0 | **0/8** |
| cold (first call in a process) | 4 | 455.9 / 504.8 / 547.4 | 675.5 / 757.3 / 865.1 | 0/4 |
| back-to-back "warm" | 28 | 158.8 / **202.1** / 338.6 | 158.9 / 423.8 / 664.7 | 19/28 |
| — pool A, 5 candidates | 14 | 158.8 / 199.8 / 328.2 | 158.9 / 367.3 / 523.9 | 11/14 |
| — pool B, 15 candidates | 14 | 182.1 / 222.2 / 338.6 | 354.8 / 513.3 / 664.7 | 8/14 |

**The warm row is not the demo.** Those 28 samples were ~0.5s apart. `api.typesafe.ai`
sends no `Keep-Alive` header, so undici drops the idle socket and a realistic
pause pays connection setup again — within the *same* compose, the `select` call
after 15s idle cost 339.9 / **466.8** / 639.7ms while the `layout` call issued
back-to-back immediately after it cost 186.4 / **210.2** / 236.7ms. Same model,
same size payload, 2.2× apart. **Treat ~470ms, not ~200ms, as the operative
first-event number on stage.**

And the budget clock starts at end of utterance, not at `compose()`. Agent A's
route call runs first and sequentially, so add another round trip in front of
every number above.

Elements composed: 2–6 (median 3), capped far below `maxElements: 24`.
Partials before `complete`: **2** in 26 of the 32 back-to-back runs, **1** in 6
(the short-circuit, which fires when only one or two elements are selected).

Cost — input tokens per compose (TypeSafe bills $42/10⁹ input, output free):
min 1081 (**$0.000045**), median 3289 (**$0.000138**), max 4314 (**$0.000181**).
Pool A median 1814 ($0.000076); pool B median 3296 ($0.000138). The whole spike:
97,208 input tokens, **$0.0041** over 40 composes.

**Not deterministic.** Across 4 repeats of each prompt, 5 of 8 prompt×pool groups
returned an identical tree every time; 3 varied. `I put in too much sugar`
produced 2 distinct trees on pool A (2 or 3 elements — and therefore 1 or 2 HTTP
calls) and 3 distinct trees on pool B (5 or 6 elements).
`text Sam that I'm running late` produced 3 distinct answer sets on pool B.

## Why the first partial is not a paint target

The `select` snapshot attaches **every selected element flat under the root's
default slot**; the `layout` call then reparents and reorders. Element *count*
never changed between first partial and `complete` in any of the 32 runs, but the
parent map changed in **23 of 32**. Painting the first partial and accepting the
composed one means a reparent ~210ms later — a full reflow, which is exactly what
the renderer's permanent reservations exist to prevent.

## Two failure modes in the shipped adapter

1. **It cannot authenticate with the credential this environment has.**
   `experimental_createEvaluator` posts to
   `ai-gateway.vercel.sh/v4/ai/evaluation-model` and needs a Vercel AI Gateway
   key; the project's TypeSafe key returns **HTTP 401** there (measured, 641ms to
   failure). `npm run jev:smoke` wants `AI_GATEWAY_API_KEY` from a `.env` that is
   not in the repo, so it is unrunnable as checked in. These numbers were obtained
   by intercepting `globalThis.fetch` and forwarding the identical
   `{state, questions}` payload to `api.typesafe.ai/v1/systemone` — the endpoint
   the P3 client uses. Everything above the socket is the shipped code path (the
   one deviation: the shim does not forward `init.signal`, which matters only for
   an abort test). A working gateway adds a proxy hop, so **these are a lower bound.**
2. **It hides failures** (CLAUDE.md constraint 5). `stopReason: 'unavailable'`
   yields `spec: null`, which `if (!event.spec) continue` swallows — the
   generator ends with zero events and no error. `stopReason: 'limit'` is mapped
   to `'partial'`, so `complete` never arrives and the caller cannot tell it apart
   from a compose still in flight. The adapter also discards `steps[]` and
   `inputTokens`, so spend is invisible to callers. This is code-derived, not
   observed: Jev never once chose `unavailable` in 40 runs — even
   `text Sam that I'm running late` against a study-task-themed pool returned a
   2-element surface rather than declining.

## What would have to change

The floor is **one Jev round trip**: ~200ms only if the connection is already hot,
~470ms median at the demo's actual cadence, ~500ms genuinely cold. A Pi on venue
wifi will be worse. No configuration beats this — `maxElements`, `maxDepth` and the
30s abort are irrelevant to the cost; the two serialized model calls are all of it.

The change that restores paint-first is **not** "paint a composed partial early."
Note what it is not, because the obvious fix does not work: a template skeleton and
a composed spec are **different-shaped trees**, and swapping one for the other is
the reflow the reservation model forbids. You cannot paint a placeholder and layer
the composed tree onto it.

So the choice is between two whole paths, and it has to be made rather than hedged:

- **Templates (existing agent-2/3 path).** One Jev call — batched with route and
  the style axes, as the P3 client already does — yields a template ID, and the
  renderer paints that template's permanent reservations immediately. Still one
  round trip, so still not literally <250ms at the demo's cadence, but it is
  *one* trip rather than two, reservation-stable, and it never reflows. Closing
  the remaining gap is then a connection problem (a keep-alive warmer ticking
  during idle, which is cheap and which the P3 client's 30s agent already
  anticipates), not an architecture problem.
- **`composeSpec`.** Two serialized trips, no safe intermediate paint target, and
  non-deterministic tree shape for the same utterance.

On these numbers, templates. If `composeSpec` stays, it belongs behind the first
paint as a later refinement of an already-painted template, accepting that the
refinement is a surface replacement and animating it as one.
