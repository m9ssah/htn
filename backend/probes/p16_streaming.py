"""Probe 16 -- for an agent runtime, total latency is the wrong metric.

The LLM node is a Pi agent (@earendil-works/pi-agent-core): stateful, tool
loop, event streaming. Probe 14 measured 5.5s to a COMPLETE ContentPatch, and
treated that as the cost.

But `ContentPatch` is `Partial<...>` and the schema says slots "arrive as they
are produced", with unfilled ones shimmering. So the number that matters is
time-to-FIRST-slot, not time-to-last.

Measured here by streaming and timestamping each slot as it becomes parseable.
"""
import json, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "schema_contract.json").read_text())
SLOTS = C["slots"]

TEMPLATE = "recipe_overview"   # the widest template: 13 slots
tslots = {s: k for s, k in SLOTS.items() if s.startswith(TEMPLATE + ".")}
PROMPT = (
    "You are agent 1 in a just-in-time UI. Fill these slots for the utterance "
    '"show me the whole recipe" (a simple weeknight pasta).\n'
    "Emit ONE JSON object per line, nothing else, no fence, in this form:\n"
    '{"slot":"<slotId>","value":{...}}\n'
    "Shapes: Heading/Text/Label/Button {kind,text} | ListItem {kind,title,detail?,meta?} "
    "| Slider {kind,label,min,max,step,value}\n"
    "Emit the title first, then the rest. Slots and their kinds:\n"
    + json.dumps(tslots, indent=1))

print(f"template {TEMPLATE} · {len(tslots)} slots · streaming\n")
t0 = time.perf_counter()
proc = subprocess.Popen(
    ["claude", "-p", PROMPT, "--model", "sonnet", "--output-format", "stream-json",
     "--include-partial-messages", "--verbose"],
    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)

buf, seen, first_text = "", [], None
for line in proc.stdout:
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    delta = ""
    if ev.get("type") == "stream_event":
        d = ev.get("event", {}).get("delta", {})
        delta = d.get("text", "") or d.get("partial_json", "") or ""
    elif ev.get("type") == "assistant":
        for blk in ev.get("message", {}).get("content", []):
            if blk.get("type") == "text":
                delta += blk.get("text", "")
    if not delta:
        continue
    if first_text is None:
        first_text = time.perf_counter() - t0
        print(f"  first token           {first_text*1000:7.0f}ms")
    buf += delta
    for m in re.finditer(r'\{"slot"\s*:\s*"([^"]+)"[^\n]*?\}\s*\}', buf):
        sid = m.group(1)
        if sid not in [s for s, _ in seen]:
            t = time.perf_counter() - t0
            seen.append((sid, t))
            tag = "  <- FIRST SLOT" if len(seen) == 1 else ""
            print(f"  slot {len(seen):>2}/{len(tslots)} {sid:<34}{t*1000:7.0f}ms{tag}")
proc.wait()
total = time.perf_counter() - t0

print(f"\n  total (last slot / exit) {total*1000:7.0f}ms")
if seen:
    print(f"\nWHAT THIS MEANS FOR THE SHIMMER")
    print(f"  time to first token        : {first_text*1000:.0f}ms")
    print(f"  time to FIRST slot filled  : {seen[0][1]*1000:.0f}ms")
    print(f"  time to LAST slot filled   : {seen[-1][1]*1000:.0f}ms")
    print(f"  slots filled               : {len(seen)}/{len(tslots)}")
    print(f"\n  Jev reshape (skeleton+style) lands at ~214ms — before any of this.")
    print(f"  Perceived: UI reshapes at 214ms, first content at {seen[0][1]*1000:.0f}ms,")
    print(f"  remaining slots shimmer and fill until {seen[-1][1]*1000:.0f}ms.")

(ROOT / "results" / "p16_streaming.json").write_text(json.dumps(dict(
    template=TEMPLATE, n_slots=len(tslots),
    first_token_ms=round((first_text or 0) * 1000),
    slots=[(s, round(t * 1000)) for s, t in seen],
    total_ms=round(total * 1000)), indent=2))
print(f"\nwrote {ROOT/'results'/'p16_streaming.json'}")
