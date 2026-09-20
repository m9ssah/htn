"""Probe 15 -- retune the `needs_research` gate, the most expensive node in the flow.

In probe 14 it fired on 4/8 requests that needed no lookup, sending them down a
5.5s path instead of a 214ms one. Hypothesis: the wording. "External or stored
information must be looked up" is literally TRUE of "show me the whole recipe",
because the recipe IS stored data.

Gold = does this need the keywords -> search -> filter loop, i.e. a lookup
beyond what the session already holds?
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul  # noqa: E402

jev = Jev(max_usd=1.5)
REPS = 3

CASES = [
    # (utterance, needs external lookup?)
    ("make it high contrast, I can't read this", False),
    ("make the text bigger", False),
    ("go back", False),
    ("ok what's the next step", False),
    ("show me the whole recipe", False),
    ("I burnt the sauce", False),
    ("how does this device work", False),
    ("start over", False),
    ("what should I make tonight", False),
    ("is this recipe actually healthy", True),
    ("what's the weather like tomorrow", True),
    ("how much is saffron going for right now", True),
    ("is the grocery store still open", True),
    ("are there any recalls on this ingredient", True),
    ("what wine goes well with this", True),
]

WORDINGS = {
    "w1 original (probe 14)": dict(
        q="Does answering this require information not already on the device?",
        t="External or stored information must be looked up first",
        f="The request is about the interface itself, or is already answerable"),
    "w2 session-scoped": dict(
        q="Does answering this require information the current session does not already hold?",
        t="The answer depends on facts the device has not already been given in this session",
        f="The device can answer from the recipe, step or state it already has, "
          "or the request only changes the interface"),
    "w3 external-only": dict(
        q="Does answering this require querying an outside source such as the web or an API?",
        t="A live or external lookup is required — prices, weather, opening hours, "
          "nutrition data, recalls, or anything that changes independently of this device",
        f="Answerable from the current recipe or session state, from general knowledge, "
          "or by changing the interface"),
    "w4 external-only + examples": dict(
        q="Does answering this require querying an outside source such as the web or an API?",
        t="A live external lookup is required. Examples: 'what's the weather', "
          "'how much does saffron cost', 'is the store open', 'any recalls on this'",
        f="No lookup needed. Examples: 'make it high contrast', 'what's the next step', "
          "'show me the recipe', 'I burnt the sauce', 'go back'"),
}

print(f"{len(CASES)} utterances ({sum(c[1] for c in CASES)} need lookup, "
      f"{sum(not c[1] for c in CASES)} do not) x {REPS} reps\n")
print(f"{'wording':<28}{'acc':<8}{'false ALARM':<14}{'missed':<9}{'ms':<7}over-triggered on")
print("-" * 112)
best, rows = None, []
for wname, w in WORDINGS.items():
    correct, fa, miss, lats, fa_cases = 0, 0, 0, [], []
    for utt, gold in CASES:
        vals = []
        for _ in range(REPS):
            r = jev.evaluate({"utterance": utt},
                             {"needs_research": noul(w["q"], true=w["t"], false=w["f"])})
            if r.ok:
                vals.append(r.answers["needs_research"].value); lats.append(r.latency_s)
        m = st.mean(vals)
        pred = m >= 0.5
        if pred == gold:
            correct += 1
        elif pred and not gold:
            fa += 1; fa_cases.append(utt.split()[0] + "…" + utt.split()[-1])
        else:
            miss += 1
    acc = correct / len(CASES)
    print(f"{wname:<28}{acc:<8.0%}{fa:<14}{miss:<9}{st.median(lats)*1000:<7.0f}"
          f"{'; '.join(fa_cases[:3])[:44]}")
    rows.append(dict(wording=wname, accuracy=round(acc, 3), false_alarms=fa, missed=miss))
    if best is None or (acc, -fa) > (best[1], -best[2]):
        best = (wname, acc, fa, w)

print(f"\n  BEST: {best[0]}  accuracy {best[1]:.0%}, {best[2]} false alarms")

# ---- cost of the false alarms, in seconds --------------------------------
FAST_MS, SLOW_S = 214, 5.5
n = len(CASES)
print(f"\nLATENCY COST OF OVER-TRIGGERING  (fast {FAST_MS}ms · slow {SLOW_S}s)")
print(f"  {'wording':<28}{'slow-path turns':<18}{'mean latency/turn'}")
print("  " + "-" * 62)
for row in rows:
    # turns that take the slow path = true positives + false alarms
    tp = sum(c[1] for c in CASES) - row["missed"]
    slow = tp + row["false_alarms"]
    mean_ms = (slow * SLOW_S * 1000 + (n - slow) * FAST_MS) / n
    print(f"  {row['wording']:<28}{slow}/{n:<15}{mean_ms:.0f}ms")
    row["slow_turns"] = slow
    row["mean_ms"] = round(mean_ms)

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p15_research_gate.json"
res.write_text(json.dumps(dict(rows=rows, best=best[0], best_criteria=best[3]), indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}\nwrote {res}")

# ---- threshold sweep on the winning wording -------------------------------
# w3 removed every false alarm but introduced 2 misses. A miss is a wrong
# answer; a false alarm is 5.3 wasted seconds. The threshold sets that trade.
print("\n\nTHRESHOLD SWEEP on the best wording")
w = best[3]
raw = {}
for utt, gold in CASES:
    vals = []
    for _ in range(REPS):
        r = jev.evaluate({"utterance": utt},
                         {"needs_research": noul(w["q"], true=w["t"], false=w["f"])})
        if r.ok:
            vals.append(r.answers["needs_research"].value)
    raw[utt] = (st.mean(vals), gold)

print(f"  {'T':<7}{'acc':<8}{'false alarm':<14}{'missed':<9}{'mean latency/turn'}")
print("  " + "-" * 60)
sweep = []
for T in (0.20, 0.30, 0.40, 0.50, 0.60):
    fa = sum(1 for m, g in raw.values() if m >= T and not g)
    miss = sum(1 for m, g in raw.values() if m < T and g)
    acc = (len(raw) - fa - miss) / len(raw)
    slow = sum(1 for m, _ in raw.values() if m >= T)
    mean_ms = (slow * 5500 + (len(raw) - slow) * 214) / len(raw)
    flag = "  <- no misses" if miss == 0 else ("  <- no false alarms" if fa == 0 else "")
    print(f"  {T:<7.2f}{acc:<8.0%}{fa:<14}{miss:<9}{mean_ms:.0f}ms{flag}")
    sweep.append(dict(T=T, acc=round(acc, 3), false_alarms=fa, missed=miss,
                      mean_ms=round(mean_ms)))

print("\n  per-utterance probabilities (best wording):")
for utt, (m, g) in sorted(raw.items(), key=lambda kv: -kv[1][0]):
    print(f"    {m:.2f}  {'LOOKUP' if g else '  none':<8}{utt}")

Path(__file__).resolve().parents[1].joinpath("results", "p15_sweep.json").write_text(
    json.dumps(dict(sweep=sweep, raw={k: [round(v[0], 3), v[1]] for k, v in raw.items()}), indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}")
