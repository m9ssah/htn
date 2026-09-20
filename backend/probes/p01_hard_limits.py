"""Probe 1 -- Jev's hard structural limits.

Answers: how many questions per call, how many options per Choice, how big a
state, and how latency scales with each. These are the walls the benchmark
design has to live inside, so they get measured before any quality test.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice, noul, score  # noqa: E402

jev = Jev(max_requests=400, max_usd=1.00)
out = []


def rec(probe, dim, ok, latency, tokens=0, note=""):
    row = dict(probe=probe, dim=dim, ok=ok, latency_s=round(latency, 3),
               input_tokens=tokens, note=note[:300])
    out.append(row)
    flag = "ok " if ok else "ERR"
    print(f"  {flag} {dim:>28}  {latency*1000:7.0f}ms  {tokens:>6}tok  {note[:80]}")


STATE = {"request": "User needs to pick one shipping speed from a small set.",
         "framework": "React + Tailwind", "surface": "mobile"}

# --- A. questions per request ----------------------------------------------
print("\nA. questions per request (the widely-quoted max of 32 is the\n   pi-typesafe wrapper's cap, not the API's -- 64 verified OK here)")
for n in (1, 4, 8, 16, 32, 33, 40, 64):
    qs = {f"q{i}": noul(f"Is constraint number {i} relevant to this request?")
          for i in range(n)}
    r = jev.evaluate(STATE, qs)
    rec("questions_per_request", f"{n} questions", r.ok, r.latency_s,
        r.input_tokens, "" if r.ok else r.error)

# --- B. options per Choice --------------------------------------------------
print("\nB. options per Choice question")
COUNTRIES = ["Canada", "United States", "Mexico", "Brazil", "Argentina", "Chile"]
for n in (3, 10, 25, 50, 100, 200):
    crit = {f"opt_{i}": f"Option number {i}" for i in range(n - 1)}
    crit["canada"] = "Canada, in North America"
    r = jev.evaluate("The user says they live in Canada.",
                     {"pick": choice("Which option names the user's country?", crit)})
    note = ""
    if r.ok:
        a = r.answers["pick"]
        note = f"picked={a.value} correct={a.value=='canada'} conf={a.confidence:.2f}"
    else:
        note = r.error
    rec("options_per_choice", f"{n} options", r.ok, r.latency_s, r.input_tokens, note)

# --- C. score levels --------------------------------------------------------
print("\nC. levels per Score question")
for n in (2, 3, 5, 10, 20):
    levels = [f"Level {i} situation description" for i in range(n)]
    r = jev.evaluate("A moderately complex request.",
                     {"s": score("How complex is this request?", levels)})
    note = "" if not r.ok else f"score={r.answers['s'].value}"
    rec("score_levels", f"{n} levels", r.ok, r.latency_s, r.input_tokens,
        note if r.ok else r.error)

# --- D. state size ----------------------------------------------------------
print("\nD. state payload size")
for kb in (1, 4, 16, 32, 64, 128, 256):
    filler = "The application uses semantic design tokens. " * (kb * 1024 // 46)
    r = jev.evaluate({"notes": filler, "ask": "add a dark mode toggle"},
                     {"rel": noul("Does the request concern theming?")})
    rec("state_size", f"~{kb} KiB", r.ok, r.latency_s, r.input_tokens,
        "" if r.ok else r.error)

# --- E. latency floor (repeat identical tiny call) --------------------------
print("\nE. latency floor, 12 identical minimal calls")
lats = []
for i in range(12):
    r = jev.evaluate("ping", {"q": noul("Is this a test message?")})
    if r.ok:
        lats.append(r.latency_s)
if lats:
    lats_sorted = sorted(lats)
    p50 = lats_sorted[len(lats) // 2]
    print(f"  min={min(lats)*1000:.0f}ms  p50={p50*1000:.0f}ms  max={max(lats)*1000:.0f}ms")
    out.append(dict(probe="latency_floor", dim="12x minimal", ok=True,
                    latency_s=round(p50, 3), input_tokens=0,
                    note=f"min={min(lats):.3f} p50={p50:.3f} max={max(lats):.3f}"))

res = Path(__file__).resolve().parents[1] / "results" / "p01_hard_limits.json"
res.write_text(json.dumps(out, indent=2))
print(f"\nrequests={jev.requests}  input_tokens={jev.input_tokens}  est_cost=${jev.usd:.5f}")
print(f"wrote {res}")
