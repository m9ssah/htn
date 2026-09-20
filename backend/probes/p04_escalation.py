"""Probe 4 -- is confidence a usable escalation trigger, and is Jev stable?

Two questions the hybrid architecture depends on:
  1. Does Jev's confidence separate the cases it gets right from the ones it
     gets wrong? If yes, a threshold routes hard cases to the strong model.
  2. Is the argmax stable across repeated identical calls? Probabilities moving
     is fine; the decision flipping is not.

Also re-runs the two cases whose Probe 3 rubric was ambiguous, with the
question rephrased per TypeSafe's guidance ("ask what the state says").
"""
import json, statistics as st, sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul  # noqa: E402
from probes.cases import CASES  # noqa: E402

REPS = 8
jev = Jev(max_requests=800, max_usd=2.00)

# --- A. argmax stability + confidence vs correctness ------------------------
single = [c for c in CASES if c["grade"] in ("exact", "set")]
print(f"A. argmax stability over {REPS} identical calls ({len(single)} choice cases)\n")
print(f"{'case':<24}{'level':<6}{'argmax stable':<15}{'mean conf':<11}{'correct':<9}modes")
print("-" * 92)

pts = []   # (confidence, correct) for threshold sweep
rows = []
for c in single:
    picks, confs, corrects = [], [], []
    for _ in range(REPS):
        r = jev.evaluate(c["state"], c["questions"])
        if not r.ok:
            continue
        a = next(iter(r.answers.values()))
        picks.append(a.value); confs.append(a.confidence)
        ok = a.value in c["gold"]
        corrects.append(ok); pts.append((a.confidence, ok))
    modes = Counter(picks)
    stable = len(modes) == 1
    mc = st.mean(confs); acc = st.mean(corrects)
    rows.append(dict(case=c["name"], level=c["level"], stable=stable,
                     mean_conf=round(mc, 3), accuracy=round(acc, 3),
                     modes={k: v for k, v in modes.items()}))
    print(f"{c['name']:<24}{c['level']:<6}{str(stable):<15}{mc:<11.2f}{acc:<9.0%}"
          f"{dict(modes)}")

# --- B. threshold sweep -----------------------------------------------------
print("\n\nB. escalation threshold sweep -- 'if confidence < T, escalate to strong model'\n")
print(f"{'T':<8}{'escalated':<12}{'kept':<8}{'accuracy on kept':<20}{'of all decisions'}")
print("-" * 74)
sweep = []
for T in (0.0, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95):
    kept = [ok for conf, ok in pts if conf >= T]
    esc = len(pts) - len(kept)
    acc = st.mean(kept) if kept else float("nan")
    sweep.append(dict(T=T, escalated=esc, kept=len(kept),
                      acc_on_kept=round(acc, 4) if kept else None,
                      pct_escalated=round(esc / len(pts), 3)))
    print(f"{T:<8.2f}{esc:<12}{len(kept):<8}{acc:<20.1%}{esc/len(pts):.0%} escalated")

wrong_confs = [c for c, ok in pts if not ok]
right_confs = [c for c, ok in pts if ok]
print(f"\n  confidence when CORRECT : mean={st.mean(right_confs):.2f} min={min(right_confs):.2f} (n={len(right_confs)})")
if wrong_confs:
    print(f"  confidence when WRONG   : mean={st.mean(wrong_confs):.2f} max={max(wrong_confs):.2f} (n={len(wrong_confs)})")

# --- C. rubric re-test: separate "Jev wrong" from "question bad" ------------
print("\n\nC. re-testing the two ambiguous Probe 3 questions, rephrased\n")
retests = [
    ("styling/blue-to-green", {"instruction": "Change this button from blue to green.",
                               "design_system": "semantic colour tokens; a `success` green token exists"},
     {"v1_orig": noul("Is this instruction specific enough to apply without further design judgement?"),
      "v2_named": noul("Does the instruction name both the current colour and the target colour?"),
      "v3_token": noul("Can this instruction be executed by swapping one existing colour token?")},
     "expect v2/v3 high"),
    ("research-stop/enough-info",
     {"approaches_identified": 3,
      "tradeoffs": "documented and distinguishable for all three",
      "open_questions": "none recorded"},
     {"v1_orig": noul("Is the available information sufficient to choose between the approaches "
                      "without further investigation?"),
      "v2_state": noul("Does `tradeoffs` state that the tradeoffs are distinguishable?"),
      "v3_open": noul("Does `open_questions` record any unresolved question?")},
     "expect v2 high, v3 low"),
]
retest_out = []
for name, state, qs, expect in retests:
    r = jev.evaluate(state, qs)
    if r.ok:
        vals = {k: round(a.value, 3) for k, a in r.answers.items()}
        print(f"  {name:<28} {vals}   ({expect})")
        retest_out.append(dict(case=name, values=vals, expect=expect))

res = Path(__file__).resolve().parents[1] / "results"
(res / "p04_escalation.json").write_text(json.dumps(
    dict(stability=rows, sweep=sweep, retests=retest_out,
         conf_correct_mean=round(st.mean(right_confs), 4),
         conf_wrong_mean=round(st.mean(wrong_confs), 4) if wrong_confs else None,
         n_decisions=len(pts), reps=REPS), indent=2))
print(f"\nrequests={jev.requests}  est_cost=${jev.usd:.5f}")
