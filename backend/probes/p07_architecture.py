"""Probe 7 -- the diagram's nodes, with criteria-equipped nouls.

v1 measured every noul node with bare instructions, which probe 6 showed costs
real recall. This re-measures the product architecture's actual boxes.
"""
import json, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev  # noqa: E402
from probes.cases_v2 import CASES  # noqa: E402

REPS = 3
jev = Jev(max_requests=600, max_usd=2.00)
rows = []


def grade(case, answers):
    g, gold = case["grade"], case["gold"]
    if g in ("exact", "set"):
        a = next(iter(answers.values()))
        probs = a.probabilities or {}
        return a.value in gold, sum(probs.get(k, 0.0) for k in gold), \
            f"picked={a.value} conf={a.confidence:.2f}"
    tp = fp = fn = tn = 0
    wrong = []
    for k, want in gold.items():
        a = answers.get(k)
        if a is None:
            continue
        got = a.value >= 0.5
        if got and want: tp += 1
        elif got and not want: fp += 1; wrong.append(f"+{k}")
        elif not got and want: fn += 1; wrong.append(f"-{k}")
        else: tn += 1
    n = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / (tp + fn) if tp + fn else 1.0
    return fp == 0 and fn == 0, (tp + tn) / n, \
        f"P={prec:.2f} R={rec:.2f} {' '.join(wrong[:4])}"


print(f"{len(CASES)} cases x {REPS} reps, "
      f"{sum(len(c['questions']) for c in CASES)} judgments per rep\n")
print(f"{'node':<24}{'lvl':<5}{'case':<18}{'pass':<6}{'score':<7}{'ms':<6}detail")
print("-" * 106)
for case in CASES:
    passes, scores, lats, det = [], [], [], []
    for _ in range(REPS):
        r = jev.evaluate(case["state"], case["questions"])
        if not r.ok:
            passes.append(False); scores.append(0.0); det.append(f"ERR {r.error[:40]}"); continue
        p, s, d = grade(case, r.answers)
        passes.append(p); scores.append(s); lats.append(r.latency_s); det.append(d)
    pr, sc = st.mean(passes), st.mean(scores)
    ms = st.median(lats) * 1000 if lats else 0
    rows.append(dict(node=case["node"], level=case["level"], case=case["name"],
                     pass_rate=round(pr, 3), score=round(sc, 3), p50_ms=round(ms),
                     detail=det[0], n_q=len(case["questions"])))
    print(f"{case['node']:<24}{case['level']:<5}{case['name']:<18}"
          f"{'PASS' if pr==1 else ('~' if pr>0 else 'FAIL'):<6}{sc:<7.2f}{ms:<6.0f}{det[0][:44]}")

print("\n\nPER-NODE  (v2 = criteria-equipped; v1 = bare nouls, probe 3)")
print(f"{'node':<26}{'cases':<7}{'exact':<8}{'per-judgment':<14}{'p50 ms':<9}worst")
print("-" * 76)
by = defaultdict(list)
for r in rows:
    by[r["node"]].append(r)
summary = {}
for node, rs in by.items():
    pr = st.mean([r["pass_rate"] for r in rs]); sc = st.mean([r["score"] for r in rs])
    ms = st.median([r["p50_ms"] for r in rs])
    failed = [r["level"] for r in rs if r["pass_rate"] < 1]
    worst = min(failed) if failed else "-none-"
    summary[node] = dict(cases=len(rs), exact=round(pr, 3), per_judgment=round(sc, 3),
                         p50_ms=round(ms), first_fail=worst)
    print(f"{node:<26}{len(rs):<7}{pr:<8.0%}{sc:<14.2f}{ms:<9.0f}{worst}")

print("\nBY LEVEL")
bylv = defaultdict(list)
for r in rows:
    bylv[r["level"]].append(r["score"])
for lv in sorted(bylv):
    print(f"  {lv}: per-judgment {st.mean(bylv[lv]):.2f}  (n={len(bylv[lv])})")

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p07_architecture.json"
res.write_text(json.dumps(dict(rows=rows, summary=summary, reps=REPS,
                               requests=jev.requests, usd=round(jev.usd, 5)), indent=2))
print(f"\nrequests={jev.requests}  est_cost=${jev.usd:.5f}\nwrote {res}")
