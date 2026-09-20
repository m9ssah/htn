"""Probe 17 -- decompose the 5935ms time-to-first-token from probe 16.

Probe 16 measured TTFT=5935ms for a ContentPatch via `claude -p`, and I claimed
that number is harness prefill rather than the model -- i.e. that a Pi agent
with a one-line system prompt and no tools would be far faster.

That was a hypothesis, not a measurement. This probe tests it by splitting
every run into three buckets:

    spawn ---> system/init ---> message_start ---> first text_delta
        CLI startup         API request + prefill      model TTFT
    (MCP boot, hooks,      (system prompt + tool     (what a Pi agent
     plugins, CLAUDE.md)    definitions, cacheable)    would inherit)

Only the third bucket is a property of the model. The first two are Claude
Code's harness and are exactly what `pi-agent-core` does NOT carry.

Ladder, all on the same task prompt, --model sonnet for comparability with p16:
    A  baseline        p16's invocation, untouched
    B  prompt-stripped --system-prompt (one line) only; tools/MCP/hooks intact
    C  fully stripped  --bare --restricted --tools "" --strict-mcp-config
    D  floor           arm C, trivial prompt -- irreducible cost of a call

3 reps each. Run 1 is reported separately from runs 2-3: Claude Code
prompt-caches, and that cold/warm delta IS the evidence for or against the
"cache the prefix" recommendation, so averaging it away would hide the answer.

CONSTRAINT: there is no ANTHROPIC_API_KEY in this environment and no
credentials file, so `pi-agent-core` itself cannot be run here. This is a
proxy measurement. The user should run the same decomposition against their
own agent: `message_start` -> first `text_delta` on the `message_update` event.
"""
import json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "results" / "p17_raw"
C = json.loads((ROOT / "schema_contract.json").read_text())
SLOTS = C["slots"]

TEMPLATE = "recipe_overview"
tslots = {s: k for s, k in SLOTS.items() if s.startswith(TEMPLATE + ".")}

# Identical to probe 16's prompt, so the task cost is held constant.
TASK = (
    "You are agent 1 in a just-in-time UI. Fill these slots for the utterance "
    '"show me the whole recipe" (a simple weeknight pasta).\n'
    "Emit ONE JSON object per line, nothing else, no fence, in this form:\n"
    '{"slot":"<slotId>","value":{...}}\n'
    "Shapes: Heading/Text/Label/Button {kind,text} | ListItem {kind,title,detail?,meta?} "
    "| Slider {kind,label,min,max,step,value}\n"
    "Emit the title first, then the rest. Slots and their kinds:\n"
    + json.dumps(tslots, indent=1))

TRIVIAL = "Reply with exactly one word: ok"
TINY_SYS = "You emit only what the user asks for. No preamble."

STREAM = ["--output-format", "stream-json", "--include-partial-messages", "--verbose"]
# NOTE: --bare also skips keychain reads, which breaks auth here ("Not logged
# in"), so it cannot be part of the stripped arm. Its one usable datapoint:
# with --bare the CLI reached `init` in ~230ms vs ~1200-1700ms baseline, so
# hooks + plugins + MCP boot are worth about 1s of startup on their own.
STRIP = ["--restricted", "--tools", "", "--strict-mcp-config",
         "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands",
         "--system-prompt", TINY_SYS]

ARMS = [
    ("A baseline",        TASK,    []),
    ("B prompt-stripped", TASK,    ["--system-prompt", TINY_SYS]),
    ("C fully stripped",  TASK,    STRIP),   # the pi-agent analogue
    ("D floor",           TRIVIAL, STRIP),
]
REPS = 4


def run(arm, prompt, extra, rep):
    """One invocation. Timestamp every event; dump raw for post-hoc analysis."""
    cmd = ["claude", "-p", prompt, "--model", "sonnet"] + STREAM + extra
    events, t0 = [], time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, bufsize=1)
    for line in proc.stdout:
        t = time.perf_counter() - t0
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        events.append((t, ev))
    proc.wait()
    total = time.perf_counter() - t0

    tag = arm.split()[0]
    (RAW / f"{tag}_rep{rep}.jsonl").write_text(
        "\n".join(json.dumps({"t_ms": round(t * 1000, 1), "ev": e})
                  for t, e in events))

    m = {"arm": arm, "rep": rep, "total_ms": round(total * 1000),
         "init_ms": None, "message_start_ms": None, "first_text_ms": None,
         "first_block_type": None, "n_tools": None, "n_mcp": None,
         "cache_read": None, "cache_write": None, "input_tokens": None}

    for t, ev in events:
        ty = ev.get("type")
        if ty == "system" and ev.get("subtype") == "init" and m["init_ms"] is None:
            m["init_ms"] = round(t * 1000)
            m["n_tools"] = len(ev.get("tools", []) or [])
            m["n_mcp"] = len(ev.get("mcp_servers", []) or [])
        if ty == "stream_event":
            e = ev.get("event", {})
            et = e.get("type")
            if et == "message_start" and m["message_start_ms"] is None:
                m["message_start_ms"] = round(t * 1000)
                u = e.get("message", {}).get("usage", {}) or {}
                m["input_tokens"] = u.get("input_tokens")
                m["cache_read"] = u.get("cache_read_input_tokens")
                m["cache_write"] = u.get("cache_creation_input_tokens")
            if et == "content_block_start" and m["first_block_type"] is None:
                m["first_block_type"] = e.get("content_block", {}).get("type")
            if et == "content_block_delta" and m["first_text_ms"] is None:
                d = e.get("delta", {})
                if d.get("text") or d.get("partial_json") or d.get("thinking"):
                    m["first_text_ms"] = round(t * 1000)
    return m


def bucket(m):
    """(cli_startup, api_prefill, model_ttft) -- None-safe."""
    i, s, f = m["init_ms"], m["message_start_ms"], m["first_text_ms"]
    return (i, (s - i) if (s is not None and i is not None) else None,
            (f - s) if (f is not None and s is not None) else None)


rows = []
for arm, prompt, extra in ARMS:
    print(f"\n{arm}")
    for rep in range(1, REPS + 1):
        m = run(arm, prompt, extra, rep)
        rows.append(m)
        c, p, k = bucket(m)
        fmt = lambda v: f"{v:>6}" if v is not None else "     ?"
        print(f"  rep{rep}  startup{fmt(c)}ms  prefill{fmt(p)}ms  "
              f"model{fmt(k)}ms   ttft={fmt(m['first_text_ms'])}ms  "
              f"total={m['total_ms']:>6}ms  tools={m['n_tools']} "
              f"mcp={m['n_mcp']} in={m['input_tokens']} "
              f"cread={m['cache_read']} blk={m['first_block_type']}")
        sys.stdout.flush()

out = ROOT / "results" / "p17_ttft_decomposed.json"
out.write_text(json.dumps(rows, indent=2))

print("\n" + "=" * 78)
print(f"{'arm':<18}{'run':<6}{'startup':>9}{'prefill':>9}{'model':>9}"
      f"{'TTFT':>9}{'total':>9}")
print("-" * 78)
for arm, _, _ in ARMS:
    a = [r for r in rows if r["arm"] == arm]
    for label, sub in (("cold", a[:1]), ("warm", a[1:])):
        if not sub:
            continue
        bs = [bucket(r) for r in sub]
        avg = lambda i: (round(sum(b[i] for b in bs if b[i] is not None)
                               / max(1, sum(1 for b in bs if b[i] is not None)))
                         if any(b[i] is not None for b in bs) else None)
        tt = [r["first_text_ms"] for r in sub if r["first_text_ms"] is not None]
        to = [r["total_ms"] for r in sub]
        f = lambda v: f"{v:>9}" if v is not None else "        ?"
        print(f"{arm:<18}{label:<6}{f(avg(0))}{f(avg(1))}{f(avg(2))}"
              f"{f(round(sum(tt)/len(tt)) if tt else None)}"
              f"{f(round(sum(to)/len(to)))}")
print("=" * 78)
print(f"\nraw events -> {RAW}/\nsummary    -> {out}")
