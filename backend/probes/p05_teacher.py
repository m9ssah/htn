"""Probe 5 -- independent teacher grading of Jev's choice-based decisions.

Answers three things probe 3 could not:
  - Quality Gap: does a strong model choose differently from Jev?
  - Rubric score: how bad are the disagreements on the spec's 0-4 scale?
  - Are the disputed gold labels actually sound?
"""
import json, statistics as st, sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev  # noqa: E402
from probes.cases import CASES  # noqa: E402
from teacher import grade_all  # noqa: E402

jev = Jev(max_usd=1.0)
single = [c for c in CASES if c["grade"] in ("exact", "set")]

print(f"1. collecting Jev answers for {len(single)} choice cases")
payload, jev_lat = [], []
for c in single:
    r = jev.evaluate(c["state"], c["questions"])
    a = next(iter(r.answers.values()))
    jev_lat.append(r.latency_s)
    q = next(iter(c["questions"].values()))
    payload.append(dict(
        id=c["name"], level=c["level"], node=c["node"],
        state=c["state"], question=q["instructions"], options=q["criteria"],
        jev_choice=a.value, jev_confidence=round(a.confidence, 3), gold=c["gold"]))
jev.close()
print(f"   jev p50 {st.median(jev_lat)*1000:.0f}ms\n")

print("2. teacher grading")
rows, cost, api_s = grade_all(payload)
by_id = {r["id"]: r for r in rows}

print(f"\n{'case':<24}{'lvl':<5}{'jev':<17}{'teacher':<17}{'agree':<7}{'rubric':<8}gold verdict")
print("-" * 104)
agree, rubrics, disputed = [], [], []
for p in payload:
    t = by_id.get(p["id"])
    if not t:
        continue
    ok = t["teacher_choice"] == p["jev_choice"]
    agree.append(ok); rubrics.append(t["jev_rubric"])
    if t["gold_verdict"] != "sound":
        disputed.append((p["id"], t["gold_verdict"], t.get("note", "")))
    print(f"{p['id']:<24}{p['level']:<5}{p['jev_choice']:<17}{t['teacher_choice']:<17}"
          f"{'yes' if ok else 'NO':<7}{t['jev_rubric']:<8}{t['gold_verdict']}")

print(f"\nQUALITY GAP")
print(f"  teacher/Jev agreement : {st.mean(agree):.0%}  ({sum(agree)}/{len(agree)})")
print(f"  mean rubric score     : {st.mean(rubrics):.2f} / 4")
print(f"  rubric distribution   : {dict(sorted(Counter(rubrics).items(), reverse=True))}")
print(f"  scored 4 (fully correct): {sum(1 for r in rubrics if r == 4)}/{len(rubrics)}")
print(f"  scored <=2 (needs fixing): {sum(1 for r in rubrics if r <= 2)}/{len(rubrics)}")

print(f"\nGOLD LABEL AUDIT  ({len(disputed)} of {len(payload)} disputed)")
for cid, verdict, note in disputed:
    print(f"  {cid:<24}{verdict:<13}{note}")

print(f"\nLATENCY")
print(f"  jev p50            : {st.median(jev_lat)*1000:.0f}ms")
print(f"  teacher api (batched {len(payload)} cases): {api_s:.1f}s total")
print(f"  teacher cost       : ${cost:.3f}")
print("  NOTE: teacher latency is batched+harness-laden; not a per-decision baseline.")

res = Path(__file__).resolve().parents[1] / "results" / "p05_teacher.json"
res.write_text(json.dumps(dict(rows=rows, payload=payload,
                               agreement=round(st.mean(agree), 3),
                               mean_rubric=round(st.mean(rubrics), 3),
                               disputed=disputed, teacher_cost_usd=round(cost, 4),
                               jev_p50_ms=round(st.median(jev_lat) * 1000)), indent=2))
print(f"\nwrote {res}")
