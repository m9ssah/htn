"""Probe 3 -- can Jev actually stand in for each node, and where does it break?

Runs every gold-labelled case REPS times. Records the full probability
distribution and confidence, not just the argmax, because (a) L4 cases have
several defensible answers and (b) confidence-on-a-wrong-answer is the input
to the escalation threshold.
"""
import json, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev  # noqa: E402
from probes.cases import CASES  # noqa: E402

REPS = 3
jev = Jev(max_requests=600, max_usd=2.00)
rows = []


def grade(case, answers):
    """-> (pass: bool, score: float 0-1, detail: str)"""
    g, gold = case["grade"], case["gold"]

    if g in ("exact", "set"):
        a = next(iter(answers.values()))
        probs = a.probabilities or {}
        mass = sum(probs.get(k, 0.0) for k in gold)
        return a.value in gold, mass, f"picked={a.value} conf={a.confidence:.2f} mass={mass:.2f}"

    if g == "bool":
        a = next(iter(answers.values()))
        p = a.value
        return (p >= 0.5) == gold, (p if gold else 1 - p), f"p={p:.2f} gold={gold}"

    if g in ("labels", "labels_score"):
        tp = fp = fn = tn = 0
        wrong = []
        for k, want in gold.items():
            a = answers.get(k)
            if a is None:
                continue
            got = (a.value >= 0.5) if g == "labels" else (a.value >= 1.5)
            if got and want: tp += 1
            elif got and not want: fp += 1; wrong.append(f"+{k}")
            elif not got and want: fn += 1; wrong.append(f"-{k}")
            else: tn += 1
        n = tp + fp + fn + tn
        acc = (tp + tn) / n if n else 0.0
        prec = tp / (tp + fp) if tp + fp else 1.0
        rec = tp / (tp + fn) if tp + fn else 1.0
        return fp == 0 and fn == 0, acc, (
            f"acc={acc:.2f} P={prec:.2f} R={rec:.2f} fp={fp} fn={fn} {' '.join(wrong[:5])}")
    raise ValueError(g)


print(f"running {len(CASES)} cases x {REPS} reps\n")
hdr = f"{'node':<21}{'lvl':<5}{'case':<22}{'pass':<6}{'score':<7}{'ms':<7}detail"
print(hdr); print("-" * 118)

for case in CASES:
    passes, scores, lats, details, decisions = [], [], [], [], []
    for _ in range(REPS):
        r = jev.evaluate(case["state"], case["questions"])
        if not r.ok:
            details.append(f"ERROR {r.error[:60]}"); passes.append(False); scores.append(0.0)
            continue
        p, s, d = grade(case, r.answers)
        passes.append(p); scores.append(s); lats.append(r.latency_s); details.append(d)
        # Stability must track the DECISION, not the probabilities. Comparing
        # detail strings flagged rows unstable over 2dp jitter while the argmax
        # never moved (probe 4 shows 14/15 argmax-stable).
        decisions.append(tuple(sorted(
            (k, (a.value >= 0.5) if isinstance(a.value, float) and case["grade"] in ("labels", "bool")
             else a.value) for k, a in r.answers.items())))
    pr = sum(passes) / len(passes)
    sc = st.mean(scores)
    ms = st.median(lats) * 1000 if lats else 0
    stable = len(set(decisions)) <= 1
    row = dict(node=case["node"], level=case["level"], case=case["name"],
               pass_rate=round(pr, 3), score=round(sc, 3), p50_ms=round(ms),
               stable=stable, detail=details[0], n_questions=len(case["questions"]))
    rows.append(row)
    mark = "PASS" if pr == 1 else ("~" if pr > 0 else "FAIL")
    print(f"{case['node']:<21}{case['level']:<5}{case['name']:<22}{mark:<6}"
          f"{sc:<7.2f}{ms:<7.0f}{details[0][:52]}{'' if stable else '  [UNSTABLE]'}")

# ---- aggregate ------------------------------------------------------------
print("\n\nPER-NODE SUMMARY")
print(f"{'node':<22}{'cases':<7}{'pass':<7}{'mean score':<12}{'p50 ms':<9}worst level")
print("-" * 76)
by = defaultdict(list)
for r in rows:
    by[r["node"]].append(r)
summary = {}
for node, rs in by.items():
    pr = st.mean([r["pass_rate"] for r in rs])
    sc = st.mean([r["score"] for r in rs])
    ms = st.median([r["p50_ms"] for r in rs])
    failed = [r["level"] for r in rs if r["pass_rate"] < 1]
    worst = min(failed) if failed else "-none-"
    summary[node] = dict(cases=len(rs), pass_rate=round(pr, 3), score=round(sc, 3),
                         p50_ms=round(ms), first_fail_level=worst)
    print(f"{node:<22}{len(rs):<7}{pr:<7.0%}{sc:<12.2f}{ms:<9.0f}{worst}")

print("\nBY DIFFICULTY LEVEL")
bylv = defaultdict(list)
for r in rows:
    bylv[r["level"]].append(r["pass_rate"])
for lv in sorted(bylv):
    print(f"  {lv}: {st.mean(bylv[lv]):.0%} pass  (n={len(bylv[lv])})")

res = Path(__file__).resolve().parents[1] / "results"
(res / "p03_node_suitability.json").write_text(
    json.dumps(dict(rows=rows, summary=summary, reps=REPS,
                    requests=jev.requests, usd=round(jev.usd, 5)), indent=2))
print(f"\nrequests={jev.requests}  input_tokens={jev.input_tokens}  est_cost=${jev.usd:.5f}")
