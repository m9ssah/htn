"""Probe 12 -- the LLM-generates / Jev-judges search loop.

Proposed: strong model writes the keywords, code runs the search, Jev decides
which results matter and whether to search again. That plays to both models --
the LLM does the generation Jev cannot, Jev does the per-result judgment the
LLM is too slow to do at N results.

Tests the Jev half, including Test Family 4's adversarial case: conflicting and
outdated sources.
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul, score  # noqa: E402

jev = Jev(max_usd=1.5)
REPS = 3

REL_T = ("This result would inform the answer, directly or as supporting evidence")
REL_F = ("This result has no bearing on the request, or is about a different subject")


def run(name, state, questions, gold, extra=None):
    f1s, lats, det = [], [], ""
    for _ in range(REPS):
        r = jev.evaluate(state, questions)
        if not r.ok:
            det = f"ERR {r.error[:40]}"; f1s.append(0); continue
        lats.append(r.latency_s)
        picked = {k for k, a in r.answers.items() if k in gold and a.value >= 0.5}
        want = {k for k, v in gold.items() if v}
        tp = len(picked & want)
        p = tp / len(picked) if picked else 1.0
        rc = tp / len(want) if want else 1.0
        f1s.append(0 if p + rc == 0 else 2 * p * rc / (p + rc))
        det = f"P={p:.2f} R={rc:.2f}"
        if extra:
            det += "  " + "  ".join(
                f"{k}={r.answers[k].value:.2f}" for k in extra if k in r.answers)
    print(f"  {name:<22}{st.mean(f1s):<8.2f}{st.median(lats)*1000 if lats else 0:<7.0f}{det}")
    return dict(case=name, f1=round(st.mean(f1s), 3), detail=det)


out = []
print("A. relevance filtering over search results")
print(f"  {'case':<22}{'F1':<8}{'ms':<7}detail")
print("  " + "-" * 70)

RESULTS_1 = {
    "r1": "Stripe docs: Accept a payment — create a PaymentIntent (updated 2026-08)",
    "r2": "Stripe docs: Subscriptions overview — recurring billing (updated 2026-07)",
    "r3": "Blog 2019: Why we left Stripe for Braintree",
    "r4": "Stripe docs: Tax — automatic tax calculation (updated 2026-06)",
    "r5": "Reddit: Stripe vs PayPal for a side project (2024)",
    "r6": "npm: stripe-node v18 changelog (2026-08)",
    "r7": "Wikipedia: History of the Stripe company",
    "r8": "Stack Overflow: Stripe webhook signature verification failing",
}
out.append(run("billing-impl", {
    "user_request": "Add subscription billing with Stripe to our app",
    "search_results": RESULTS_1},
    {k: noul(f"Is this result relevant to the request? Result: {v}", true=REL_T, false=REL_F)
     for k, v in RESULTS_1.items()},
    {"r1": True, "r2": True, "r3": False, "r4": True,
     "r5": False, "r6": True, "r7": False, "r8": True}))

RESULTS_2 = {
    "s1": "React docs: useEffect — synchronising with effects (current)",
    "s2": "Blog 2018: componentWillMount patterns in React 16",
    "s3": "React docs: You Might Not Need an Effect (current)",
    "s4": "GitHub issue: memory leak with async useEffect (open, 2026)",
    "s5": "Vue docs: watchEffect API reference",
    "s6": "Tutorial 2020: class components lifecycle methods",
}
out.append(run("react-effects", {
    "user_request": "Fix a memory leak in our React data-fetching hook",
    "search_results": RESULTS_2},
    {k: noul(f"Is this result relevant to the request? Result: {v}", true=REL_T, false=REL_F)
     for k, v in RESULTS_2.items()},
    {"s1": True, "s2": False, "s3": True, "s4": True, "s5": False, "s6": False}))

# --- B. adversarial: conflicting + stale ------------------------------------
print("\nB. adversarial -- conflicting and outdated sources (spec Test Family 4)")
print(f"  {'case':<22}{'F1':<8}{'ms':<7}detail")
print("  " + "-" * 70)

CONFLICT = {
    "c1": "Official docs (updated 2026-09): the default timeout is 300 seconds",
    "c2": "Blog post (2023): the default timeout is 60 seconds",
    "c3": "Stack Overflow answer (2021, 400 upvotes): default timeout is 90 seconds",
    "c4": "Changelog (2026-04): default timeout raised from 90s to 300s",
    "c5": "Unrelated: how to configure retries",
}
out.append(run("conflicting-facts", {
    "user_request": "What is the default function timeout?",
    "search_results": CONFLICT},
    dict({k: noul(f"Is this result relevant to the request? Result: {v}",
                  true=REL_T, false=REL_F) for k, v in CONFLICT.items()},
         sources_conflict=noul(
             "Do the results disagree with each other about the timeout value?",
             true="Two or more results state different values for the same fact",
             false="All results that state a value agree"),
         has_current=noul(
             "Is the most recently dated result the one to trust for a current value?",
             true="A recent authoritative source is present and supersedes older ones",
             false="No recent authoritative source is present")),
    {"c1": True, "c2": False, "c3": False, "c4": True, "c5": False},
    extra=["sources_conflict", "has_current"]))

# --- C. stopping condition: search again? -----------------------------------
print("\nC. stopping condition -- is another search needed?")
print(f"  {'scenario':<34}{'need_more':<12}{'expected'}")
print("  " + "-" * 70)
STOP = [
    ("covered: 3 authoritative, current, agree",
     {"results_found": 3, "authoritative": 3, "recency": "all within 3 months",
      "agreement": "all agree", "open_gaps": "none"}, False),
    ("thin: 1 result, 4 years old",
     {"results_found": 1, "authoritative": 0, "recency": "4 years old",
      "agreement": "n/a", "open_gaps": "no current source found"}, True),
    ("conflicting: 4 results, disagree, none authoritative",
     {"results_found": 4, "authoritative": 0, "recency": "mixed 2021-2026",
      "agreement": "they disagree", "open_gaps": "no authoritative source"}, True),
]
stop_rows = []
for label, state, expect in STOP:
    vals = []
    for _ in range(REPS):
        r = jev.evaluate(state, {"need_more": noul(
            "Should another search be run before answering?",
            true="The gathered results are too few, too old, or contradict each other",
            false="The results are sufficient, current, and consistent")})
        if r.ok:
            vals.append(r.answers["need_more"].value)
    m = st.mean(vals)
    ok = (m >= 0.5) == expect
    print(f"  {label:<34}{m:<12.2f}{expect}  {'OK' if ok else 'WRONG'}")
    stop_rows.append(dict(scenario=label, need_more=round(m, 3), expected=expect, correct=ok))

print(f"\n  stopping-condition accuracy: {sum(r['correct'] for r in stop_rows)}/{len(stop_rows)}")
jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p12_search_loop.json"
res.write_text(json.dumps(dict(relevance=out, stopping=stop_rows), indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}\nwrote {res}")
