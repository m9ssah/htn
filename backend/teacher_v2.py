"""Teacher grading for multi-label nodes, not just single-choice.

Three jobs per case, same as teacher.py, but the unit of judgment is a SET:

  teacher_labels  the keys the strong model would include, deciding for itself
  jev_rubric      0-4 on Jev's actual set
  gold_verdict    an audit of MY hand-authored label

The third job is the point of this run. The Task Assignment recommendation --
keep it on a strong model -- currently rests on gold labels I wrote and then
graded myself. If the teacher disagrees with those labels, the recommendation
is an artifact and has to be withdrawn.
"""
from __future__ import annotations

import json
import subprocess
import time

MODEL = "sonnet"

PROMPT = """You are auditing a fast decision model ("Jev") on multi-label agent decisions.

Each case gives a `user_request` (or state), a set of candidate items each with a
true/false description, Jev's selections, and a hand-authored gold set.

For EACH case do three INDEPENDENT things:

1. `teacher_labels` - Ignoring both Jev and gold, list the item keys YOU would select.
   This is the strong-model baseline.
2. `jev_rubric` - Rate Jev's selection set 0-4:
   4 fully correct | 3 minor issue, outcome unaffected | 2 partially correct, needs
   downstream correction | 1 materially wrong but recoverable | 0 failed
3. `gold_verdict` - Judge the GOLD SET (not Jev). One of "sound" / "too_narrow" /
   "too_wide" / "wrong". If not sound, name the specific keys in `note`.

Be willing to say gold is wrong. The gold labels were written by the same person
reading these results, and finding their errors is the purpose of this audit.

Return ONLY a JSON array, no prose, no markdown fence:
[{"id":"...","teacher_labels":["key1","key2"],"jev_rubric":<0-4>,"gold_verdict":"...","note":"<=25 words"}]

CASES:
"""


def ask(cases: list[dict]):
    t0 = time.perf_counter()
    p = subprocess.run(
        ["claude", "-p", PROMPT + json.dumps(cases, indent=1),
         "--model", MODEL, "--output-format", "json"],
        capture_output=True, text=True, timeout=1200)
    if p.returncode != 0:
        raise RuntimeError(f"claude -p failed: {p.stderr[:400]}")
    env = json.loads(p.stdout)
    txt = env.get("result", "")
    s, e = txt.find("["), txt.rfind("]")
    if s == -1:
        raise ValueError(f"no JSON: {txt[:300]}")
    return (json.loads(txt[s:e + 1]), env.get("total_cost_usd", 0.0),
            time.perf_counter() - t0)


def grade_all(cases, batch=5):
    out, cost = [], 0.0
    for i in range(0, len(cases), batch):
        rows, c, wall = ask(cases[i:i + batch])
        out += rows; cost += c
        print(f"  batch {i//batch+1}: {len(rows)} graded  ${c:.3f}  {wall:.0f}s")
    return out, cost
