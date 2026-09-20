"""Probe 6 -- was the 'conservative bias' Jev's, or my under-specified question?

Probe 3 found Context Selection at precision 1.00 / recall 0.86-0.89 and called
the bias a property of the model. But those nouls were bare instruction strings
with no `criteria`, which the API documents as the field that controls exactly
this. Same pool, three phrasings.
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul  # noqa: E402
from probes.cases import POOL  # noqa: E402

jev = Jev(max_usd=1.0)
REQ = "Add a dark mode toggle to the Settings page."
state = {"user_request": REQ, "available_information": {k: v[0] for k, v in POOL.items()}}
gold = {k: v[1] for k, v in POOL.items()}

VARIANTS = {
    "v1_bare (probe 3)": lambda f: noul(f"Is this fact necessary for an engineer implementing the request? Fact: {f}"),
    "v2_criteria": lambda f: noul(
        f"Should this fact be given to the engineer implementing the request? Fact: {f}",
        true="The fact constrains how the feature must be built, or describes code the feature touches",
        false="The fact is about the user, the business, or unrelated infrastructure"),
    "v3_criteria_inclusive": lambda f: noul(
        f"Could an engineer implementing the request plausibly need this fact? Fact: {f}",
        true="The fact could affect any implementation decision, even indirectly. When unsure, true.",
        false="The fact is clearly irrelevant to building this feature"),
}

print(f"pool of {len(POOL)} items, {sum(gold.values())} relevant by gold\n")
print(f"{'variant':<22}{'precision':<12}{'recall':<10}{'acc':<8}{'ms':<7}errors")
print("-" * 92)
out = []
for name, mk in VARIANTS.items():
    qs = {k: mk(v[0]) for k, v in POOL.items()}
    lats, tp = [], 0
    fp = fn = tn = 0
    errs = []
    for _ in range(3):
        r = jev.evaluate(state, qs)
        if not r.ok:
            print(f"  {name} ERROR {r.error[:60]}"); break
        lats.append(r.latency_s)
        tp = fp = fn = tn = 0; errs = []
        for k, want in gold.items():
            got = r.answers[k].value >= 0.5
            if got and want: tp += 1
            elif got and not want: fp += 1; errs.append(f"+{k}")
            elif not got and want: fn += 1; errs.append(f"-{k}")
            else: tn += 1
    n = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / (tp + fn) if tp + fn else 1.0
    acc = (tp + tn) / n if n else 0
    ms = st.median(lats) * 1000 if lats else 0
    print(f"{name:<22}{prec:<12.2f}{rec:<10.2f}{acc:<8.2f}{ms:<7.0f}{' '.join(errs)}")
    out.append(dict(variant=name, precision=round(prec, 3), recall=round(rec, 3),
                    accuracy=round(acc, 3), p50_ms=round(ms), errors=errs))
jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p06_noul_criteria.json"
res.write_text(json.dumps(out, indent=2))
print(f"\nwrote {res}")
