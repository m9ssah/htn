# Latency findings — where the 5.9s actually goes

Probe 17 (`backend/probes/p17_ttft_decomposed.py`, raw in `backend/results/p17_raw/`).

## The claim under test

Probe 16 measured **time-to-first-token = 5935ms** for a `ContentPatch` via
`claude -p`, and I asserted that number was Claude Code's harness rather than the
model — i.e. that a Pi agent with a one-line system prompt and no tools would be
far faster. That was a hypothesis. This tested it.

## Method

Every `stream-json` event timestamped against `perf_counter`, split three ways:

```
spawn ──────► system/init ──────► message_start ──────► first text_delta
   CLI startup            request + prefill          model emission
   (MCP boot, hooks,      (system prompt + tool      (the only bucket a
    plugins, CLAUDE.md)    definitions on the wire)   Pi agent inherits)
```

Four arms, same task prompt, `--model sonnet`, 4 reps each.
`init` reports the live tool/MCP counts, which is how the stripping was verified.

## Result

| arm | input tokens | tools | startup | prefill | **TTFT** (med / min–max) |
|---|---|---|---|---|---|
| A baseline (= probe 16) | 21,009 | 79 + 3 MCP | 2242ms | 3506ms | **5369ms** / 4632–6928 |
| B default system prompt replaced | 16,279 | 79 + 3 MCP | 1433ms | 2341ms | **3996ms** / 2252–5827 |
| C fully stripped | 922 | 0 | 570ms | 930ms | **1605ms** / 1172–5039 |
| D floor (trivial prompt) | 484 | 0 | 616ms | 1064ms | **1661ms** / 1546–2989 |

Arm C = `--restricted --tools "" --strict-mcp-config --system-prompt "<one line>"`.

## What it says

**The hypothesis holds, and by more than expected.** Identical task, identical
model: 5369ms → 1605ms once the harness is gone. The harness carries **21,009
input tokens against the task's 922 — 23× the input** for the same work.

**`message_start` → first `text_delta` is 0–1ms in every single run.** The API
does not open the stream until it is ready to emit. So there is no "model
thinking" bucket to optimise — *all* of the wait is request assembly + prefill,
and prefill scales with what you put in front of the task.

**The stream starts sooner; it does not run faster.** Arm C's *total* is still
6106–8540ms for the same 13 slots, against probe 16's 11326ms. Stripping the
harness moved the *start* of the stream from ~6s to ~1.2s; per-slot cadence is
unchanged at roughly 380ms. The demo picture is **first slot ~1.2s, last slot
~6–8s** — good enough for a shimmer to look deliberate, not good enough to treat
content latency as solved.

**Arm C ≈ arm D.** A 922-token task costs the same as a 484-token one. Prompt
size is not the lever at this scale; fixed overhead is. Of arm C's 1605ms,
~570ms is **CLI process spawn**, which an in-process Pi agent does not pay at
all. The number a Pi agent should actually inherit is the prefill bucket:
**roughly 600–1000ms to first token.**

**This walks back my "cache the prefix" advice.** Arm C ran with `cache_read = 0`
— no caching whatsoever — and still beat the 21K-token *cached* baseline by 3.3×.
A 922-token prompt is also at the edge of being cacheable at all — Anthropic's
minimum cacheable prefix is 1,024 tokens on Opus 4.8-era models and 512 on Opus 5 /
Fable 5 / Mythos 5 ([current docs](https://platform.claude.com/en/docs); check the
figure for whichever model you ship). Caching is what makes a bloated prompt
survivable; it is not what makes a lean one fast. Keep the prompt small and skip
the cache complexity.

**Variance is real.** Arm C rep4 hit 5039ms and an arm-B run hit 21s. Tail
latency is API-side jitter, not configuration. Plan the demo around a fallback,
not around the median.

## Two things in the repo that this changes

Both from `m9ssah/htn@b63c98a` ("update design system").

**1. `null` now means collapse, and nothing emits it yet.** `ContentPatch.slots`
is `Partial<{[S in SlotId]: SlotValueFor<S> | null}>`; `undefined` = pending
(shimmer), explicit `null` = not applicable (`renderer.ts:201` sets
`element.hidden = true`). `recipe_overview` reserves 8 ingredient slots; a
six-ingredient recipe shimmers on two of them **forever** until a null arrives.
Probe 16's prompt never emitted nulls. Emitting them *first* — they need no
content, just a count — settles the layout before any real text lands. That is
free perceived latency, available today.

**2. The four physical buttons are gated on the *tail* of agent 1, and that is a
prompt bug.** `vocab.ts`: *"Text shown on a physical-button label, once content
exists"*, and `RangeAction.range` is *"null until content lands … the descriptor
exists at skeleton paint, but nothing has told us yet what the axis means."*
Button labels are `Button`-kind **`ContentPatch`** slots — so plan step 17
(*"changing stated intent visibly relabels and remaps all four"*) fires whenever
those slots happen to arrive. In probe 16 that was **slot 13 of 13, at 10456ms**,
purely because the prompt said *"emit the title first, then the rest"* and the
Button sorted last.

Fix the emission order before anything else: **title → Button slots → nulls →
body content.** That relabels the hardware at roughly first-slot latency (~1.5s)
with no schema change, no Jev work, and no new node — doable before hour 3.

Getting it down to the 214ms reshape is a second, larger step: button labels
would have to come from an enumerated vocabulary Jev selects from rather than
generated text. Worth doing only if the reorder isn't enough on the floor.

## Not measurable here

There is no `ANTHROPIC_API_KEY` in this environment and no credentials file, so
`pi-agent-core` itself could not be run; arm C is a proxy for it, not a
measurement of it. Run the same decomposition against the real agent by
timestamping `message_start` against the first `text_delta` on `message_update`.
The repo currently contains `renderer`, `schema`, `tokens` and `nllb-600m` — no
agent code yet — so nothing is locked in.
