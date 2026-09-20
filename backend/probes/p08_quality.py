"""Probe 8 -- decision QUALITY per node, with an independent strong-model baseline.

Latency told us Jev is ~195ms. This tells us whether the decision was any good,
measured three ways that can disagree with each other:

  jev_f1      Jev vs my gold
  teacher_f1  strong model vs my gold   <- the baseline the spec asks for
  gap         teacher_f1 - jev_f1       <- Quality Gap
  rubric      teacher's 0-4 on Jev
  agreement   Jev vs teacher directly, ignoring gold entirely
"""
import json, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev  # noqa: E402
from probes.cases_v2 import CASES  # noqa: E402
from teacher_v2 import grade_all  # noqa: E402

jev = Jev(max_usd=1.0)
label_cases = [c for c in CASES if c["grade"] == "labels"]
print(f"1. Jev answers for {len(label_cases)} multi-label cases")
payload, lat = [], []
for c in label_cases:
    r = jev.evaluate(c["state"], c["questions"])
    lat.append(r.latency_s)
    picked = [k for k, a in r.answers.items() if a.value >= 0.5]
    payload.append(dict(id=c["name"], node=c["node"], level=c["level"],
                        state=c["state"],
                        items={k: q.get("criteria", {}) or q["instructions"]
                               for k, q in c["questions"].items()},
                        jev_selected=picked,
                        gold=[k for k, v in c["gold"].items() if v]))
jev.close()
print(f"   jev p50 {st.median(lat)*1000:.0f}ms\n2. teacher grading")
rows, cost = grade_all(payload)
by = {r["id"]: r for r in rows}


def f1(pred: set, gold: set):
    tp = len(pred & gold)
    p = tp / len(pred) if pred else 1.0
    r = tp / len(gold) if gold else 1.0
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)


print(f"\n{'case':<18}{'node':<24}{'jev F1':<9}{'teach F1':<10}{'gap':<8}{'rubric':<8}gold")
print("-" * 96)
res = []
for p in payload:
    t = by.get(p["id"])
    if not t:
        continue
    gold = set(p["gold"]); jv = set(p["jev_selected"]); tc = set(t["teacher_labels"])
    jf, tf = f1(jv, gold), f1(tc, gold)
    res.append(dict(case=p["id"], node=p["node"], level=p["level"],
                    jev_f1=round(jf, 3), teacher_f1=round(tf, 3),
                    gap=round(tf - jf, 3), rubric=t["jev_rubric"],
                    agreement=round(f1(jv, tc), 3),
                    gold_verdict=t["gold_verdict"], note=t.get("note", "")))
    print(f"{p['id']:<18}{p['node']:<24}{jf:<9.2f}{tf:<10.2f}{tf-jf:<+8.2f}"
          f"{t['jev_rubric']:<8}{t['gold_verdict']}")

print(f"\n\nDECISION QUALITY BY NODE")
print(f"{'node':<26}{'jev F1':<9}{'teacher F1':<12}{'quality gap':<13}{'rubric':<9}jev~teacher")
print("-" * 86)
bn = defaultdict(list)
for r in res:
    bn[r["node"]].append(r)
summary = {}
for node, rs in bn.items():
    jf = st.mean([r["jev_f1"] for r in rs]); tf = st.mean([r["teacher_f1"] for r in rs])
    ru = st.mean([r["rubric"] for r in rs]); ag = st.mean([r["agreement"] for r in rs])
    summary[node] = dict(jev_f1=round(jf, 3), teacher_f1=round(tf, 3),
                         gap=round(tf - jf, 3), rubric=round(ru, 2), agreement=round(ag, 3))
    print(f"{node:<26}{jf:<9.2f}{tf:<12.2f}{tf-jf:<+13.2f}{ru:<9.2f}{ag:.2f}")

print(f"\nGOLD AUDIT")
bad = [r for r in res if r["gold_verdict"] != "sound"]
print(f"  sound: {len(res)-len(bad)}/{len(res)}")
for r in bad:
    print(f"  {r['case']:<18}{r['gold_verdict']:<13}{r['note'][:60]}")

print(f"\nOVERALL")
print(f"  Jev F1 vs gold      : {st.mean([r['jev_f1'] for r in res]):.3f}")
print(f"  Teacher F1 vs gold  : {st.mean([r['teacher_f1'] for r in res]):.3f}")
print(f"  QUALITY GAP         : {st.mean([r['gap'] for r in res]):+.3f}")
print(f"  Teacher rubric on Jev: {st.mean([r['rubric'] for r in res]):.2f} / 4")
print(f"  Jev~teacher agreement: {st.mean([r['agreement'] for r in res]):.3f}")
print(f"  teacher cost ${cost:.2f}   jev p50 {st.median(lat)*1000:.0f}ms")

out = Path(__file__).resolve().parents[1] / "results" / "p08_quality.json"
out.write_text(json.dumps(dict(cases=res, by_node=summary, teacher_cost=round(cost, 3),
                               jev_p50_ms=round(st.median(lat)*1000)), indent=2))
print(f"\nwrote {out}")
