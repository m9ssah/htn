"""Teacher model -- an independent strong model that grades Jev's decisions.

Two roles, both needed by the spec:

  baseline  the teacher answers the same case Jev did, from the same state and
            the same option list. Disagreement is the Quality Gap.
  judge     the teacher rates Jev's actual answer 0-4 on the spec's rubric,
            and says whether the hand-authored gold label was itself correct.

The second role is the point. Three gold labels in `cases.py` are disputed
(`quiet-please`, `cta-prominent`, `twelve_controls`), and a benchmark whose
labels are written by the same person reading the results is not a benchmark.

Runs via `claude -p`, which carries ~25K tokens of harness prompt per
invocation, so cases are batched many-per-call rather than one-per-call.

CAVEAT recorded in the findings: teacher and judge are the same model family,
which cannot detect a bias they share. This measures agreement, not truth.
"""

from __future__ import annotations

import json
import subprocess
import time

MODEL = "sonnet"
BATCH = 12

PROMPT = """You are grading a low-latency decision model called Jev on UI/agent decisions.

For EACH case below you do three independent things:

1. `teacher_choice` - Ignore Jev's answer. From `options`, pick the key YOU judge
   best for `state`. This is the strong-model baseline.
2. `jev_rubric` - Rate Jev's answer `jev_choice` 0-4:
   4 fully correct and robust | 3 correct, minor issue | 2 partially correct,
   needs downstream correction | 1 materially wrong but recoverable | 0 failed/invalid
3. `gold_verdict` - The benchmark's hand-authored acceptable set is `gold`.
   Judge the LABEL, not Jev. One of:
   "sound"     the gold set is right
   "too_narrow" a defensible answer is missing from gold (say which in `note`)
   "too_wide"   gold admits an answer that is not defensible
   "wrong"      gold is simply incorrect

Where several answers are genuinely defensible, say so rather than forcing one.

Return ONLY a JSON array, one object per case, no prose, no markdown fence:
[{"id":"...","teacher_choice":"<key>","jev_rubric":<0-4>,"gold_verdict":"<one of the four>","note":"<= 20 words"}]

CASES:
"""


def ask(cases: list[dict]) -> tuple[list[dict], float, float]:
    payload = PROMPT + json.dumps(cases, indent=1)
    t0 = time.perf_counter()
    p = subprocess.run(
        ["claude", "-p", payload, "--model", MODEL, "--output-format", "json"],
        capture_output=True, text=True, timeout=900,
    )
    wall = time.perf_counter() - t0
    if p.returncode != 0:
        raise RuntimeError(f"claude -p failed: {p.stderr[:400]}")
    env = json.loads(p.stdout)
    text = env.get("result", "")
    cost = env.get("total_cost_usd", 0.0)
    api_ms = env.get("duration_api_ms", 0)

    s, e = text.find("["), text.rfind("]")
    if s == -1 or e == -1:
        raise ValueError(f"no JSON array in teacher reply: {text[:300]}")
    return json.loads(text[s:e + 1]), cost, api_ms / 1000.0


def grade_all(cases: list[dict], batch: int = BATCH):
    out, cost, api_s = [], 0.0, 0.0
    for i in range(0, len(cases), batch):
        chunk = cases[i:i + batch]
        rows, c, a = ask(chunk)
        out += rows
        cost += c
        api_s += a
        print(f"  batch {i // batch + 1}: {len(rows)} graded  ${c:.3f}  {a:.1f}s api")
    return out, cost, api_s
