"""Probe 2 -- where the token ceiling sits, and how latency really scales.

Probe 1 showed latency looked flat against question count and option count.
That is the load-bearing claim for the whole architecture, so it gets repeated
measurements rather than one sample each.
"""
import json, statistics as st, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice, noul  # noqa: E402

jev = Jev(max_requests=400, max_usd=1.50)
out = []
REPS = 7


def bench(label, state, questions):
    lats, toks, ok_n = [], 0, 0
    err = ""
    for _ in range(REPS):
        r = jev.evaluate(state, questions)
        if r.ok:
            ok_n += 1; lats.append(r.latency_s); toks = r.input_tokens
        else:
            err = r.error
    if not lats:
        print(f"  ERR {label:>22}  {err[:70]}")
        out.append(dict(label=label, ok=False, note=err[:200])); return
    p50, mn, mx = st.median(lats), min(lats), max(lats)
    print(f"  ok  {label:>22}  p50={p50*1000:6.0f}ms  min={mn*1000:6.0f}  max={mx*1000:6.0f}  {toks:>6}tok  n={ok_n}")
    out.append(dict(label=label, ok=True, p50_ms=round(p50*1000), min_ms=round(mn*1000),
                    max_ms=round(mx*1000), input_tokens=toks, n=ok_n))


print(f"\nA. latency vs QUESTION COUNT ({REPS} reps each)")
S = {"request": "add a dark mode toggle to settings", "stack": "React + Tailwind"}
for n in (1, 8, 32, 64):
    bench(f"{n} questions", S, {f"q{i}": noul(f"Is factor {i} relevant here?") for i in range(n)})

print(f"\nB. latency vs CHOICE OPTION COUNT ({REPS} reps each)")
for n in (3, 50, 200):
    crit = {f"opt_{i}": f"Option number {i}" for i in range(n - 1)}
    crit["canada"] = "Canada, in North America"
    bench(f"{n} options", "The user lives in Canada.",
          {"pick": choice("Which option names the user's country?", crit)})

print(f"\nC. latency vs STATE SIZE ({REPS} reps each)")
for kb in (1, 32, 128):
    filler = "The application uses semantic design tokens. " * (kb * 1024 // 46)
    bench(f"~{kb} KiB state", {"notes": filler, "ask": "dark mode"},
          {"rel": noul("Does the request concern theming?")})

print("\nD. token ceiling -- bisect between 128 and 256 KiB")
lo, hi = 128, 256
while hi - lo > 8:
    mid = (lo + hi) // 2
    filler = "The application uses semantic design tokens. " * (mid * 1024 // 46)
    r = jev.evaluate({"notes": filler}, {"rel": noul("Does this concern theming?")})
    print(f"    {mid:>4} KiB -> {'ok  ' + str(r.input_tokens) + ' tok' if r.ok else 'REJECTED'}")
    if r.ok: lo = mid
    else: hi = mid
print(f"  ceiling between {lo} and {hi} KiB")
out.append(dict(label="token_ceiling_kib", ok=True, lo_kib=lo, hi_kib=hi))

res = Path(__file__).resolve().parents[1] / "results" / "p02_scaling.json"
res.write_text(json.dumps(out, indent=2))
print(f"\nrequests={jev.requests}  est_cost=${jev.usd:.5f}\nwrote {res}")
