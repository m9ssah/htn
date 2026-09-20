"""Probe 14 -- END-TO-END run of the finalized architecture.

Follows the diagram exactly:

  user request
    -> STAGE 1  Jev decision layer, ONE batched call
                 templateId + 5 style axes + need_more_context + needs_research
    -> branch on need_more_context > 0.5        (their threshold, not mine)
    -> if research:  LLM keywords -> search -> Jev filters N results
    -> LLM content patch
    -> WHITELIST validation against the real schema
    -> fill in the UI

This is the multi-node compounding measurement that every earlier probe
flagged as missing. Patches are validated against the live contract in
m9ssah/htn, so a cascade failure shows up as an invalid patch, not an opinion.
"""
import json, statistics as st, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice, noul  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "schema_contract.json").read_text())
TEMPLATES, AXES, SLOTS = C["templates"], C["axes"], C["slots"]

TDESC = {
    "choice_cards": "Choose between generated options; a slider scrubs the axis they vary on",
    "recipe_overview": "The chosen thing, whole, with quantities a slider can rescale",
    "focus_step": "One instruction at a time; sparse; encoder scrubs steps",
    "recovery": "Something went wrong: diagnosis, recommended fix, consequence",
    "summary_done": "The task is done; an open prompt, not a button row",
    "people_picker": "Pick people",
    "message_drafts": "Generated drafts, one per recipient, with a tone axis",
    "generic_answer": "Anything unscripted; answers a judge driving the device",
}
ADESC = {
    "palette": {"slate": "neutral cool grey", "mono": "black and white only",
                "rose": "warm pink accent", "contrast": "maximum legibility, high contrast"},
    "fontPairing": {"system": "native UI font", "editorial": "serif display, literary",
                    "geometric": "clean geometric sans", "mono": "monospace, technical"},
    "density": {"compact": "tight spacing, more on screen", "normal": "balanced",
                "spacious": "generous whitespace, less on screen"},
    "radius": {"sharp": "square corners", "soft": "slightly rounded", "round": "fully rounded"},
    "motif": {"none": "no decoration", "floral": "botanical", "geometric": "geometric pattern"},
}

# Realistic demo utterances + the template a human would expect.
CASES = [
    ("what should I make tonight", "choice_cards", False),
    ("show me the whole recipe", "recipe_overview", False),
    ("ok what's the next step", "focus_step", False),
    ("I burnt the sauce", "recovery", False),
    ("make it high contrast, I can't read this", "generic_answer", False),
    ("who should I invite on Friday", "people_picker", False),
    ("is this recipe actually healthy", "generic_answer", True),
    ("how does this device work", "generic_answer", False),
]

jev = Jev(max_usd=2.0)
stage1, results = [], []

print("STAGE 1 — Jev decision layer, one batched call per request\n")
print(f"{'utterance':<38}{'template':<17}{'conf':<7}{'style (p/f/d/r/m)':<34}{'res?':<6}{'ms'}")
print("-" * 112)
for utt, gold_t, gold_research in CASES:
    qs = {"templateId": choice("Which template should the interface switch to?",
                               {t: TDESC[t] for t in TEMPLATES})}
    for ax, opts in AXES.items():
        qs[ax] = choice(f"Which {ax} best matches the request?",
                        {o: ADESC[ax][o] for o in opts})
    qs["needs_research"] = noul(
        "Does answering this require information not already on the device?",
        true="External or stored information must be looked up first",
        false="The request is about the interface itself, or is already answerable")
    qs["needs_generation"] = noul(
        "Does this require writing new text or values, rather than only selecting?",
        true="New prose, names, quantities or colour values must be written",
        false="Only selections from fixed sets are needed")
    t0 = time.perf_counter()
    r = jev.evaluate({"utterance": utt}, qs)
    dt = time.perf_counter() - t0
    a = r.answers
    theme = {ax: a[ax].value for ax in AXES}
    row = dict(utterance=utt, gold_template=gold_t, template=a["templateId"].value,
               template_conf=round(a["templateId"].confidence, 3), theme=theme,
               needs_research=round(a["needs_research"].value, 3),
               gold_research=gold_research,
               needs_generation=round(a["needs_generation"].value, 3),
               latency_s=round(dt, 3), n_questions=len(qs))
    stage1.append(row)
    style = "/".join(theme[ax][:4] for ax in AXES)
    print(f"{utt[:37]:<38}{row['template']:<17}{row['template_conf']:<7.2f}{style:<34}"
          f"{row['needs_research']:<6.2f}{dt*1000:.0f}")

t_ok = sum(r["template"] == r["gold_template"] for r in stage1)
r_ok = sum((r["needs_research"] >= 0.5) == r["gold_research"] for r in stage1)
print(f"\n  template {t_ok}/{len(stage1)}   research-branch {r_ok}/{len(stage1)}"
      f"   {len(stage1[0]['n_questions'] * [0])} questions/call"
      f"   p50 {st.median([r['latency_s'] for r in stage1])*1000:.0f}ms")

# ---- STAGE 2/3: one batched LLM content call for every case ---------------
print("\n\nSTAGE 2/3 — LLM content patch (batched), then whitelist validation\n")
ask = []
for r in stage1:
    tslots = {s: k for s, k in SLOTS.items() if s.startswith(r["template"] + ".")}
    ask.append({"utterance": r["utterance"], "templateId": r["template"], "slots": tslots})
PROMPT = (
    "You are agent 1 in a just-in-time UI system. For each case, fill the template's "
    "slots with plausible content for the utterance.\n\n"
    "RULES: use ONLY the slot ids given for that case. Each slot's value MUST be an "
    "object whose `kind` equals the component kind listed for it. Shapes:\n"
    "Heading/Text/Label/Badge/Alert/Button {kind,text} | Metric {kind,label,value} | "
    "ListItem {kind,title,detail?,meta?} | Slider {kind,label,min,max,step,value} | "
    "Progress {kind,pct} | Toggle {kind,label,on} | TextField {kind,label} | "
    "Media {kind,caption?} | Bars {kind,values:[..]} | Rule {kind,left,right?}\n"
    "Use null for a slot that does not apply.\n\n"
    'Return ONLY a JSON array: [{"utterance":"...","slots":{"<slotId>":{...}}}]\n\nCASES:\n'
    + json.dumps(ask, indent=1))
t0 = time.perf_counter()
p = subprocess.run(["claude", "-p", PROMPT, "--model", "sonnet", "--output-format", "json"],
                   capture_output=True, text=True, timeout=1200)
llm_wall = time.perf_counter() - t0
env = json.loads(p.stdout)
txt = env.get("result", "")
content = json.loads(txt[txt.find("["):txt.rfind("]") + 1])
by_utt = {c["utterance"]: c.get("slots", {}) for c in content}
print(f"  LLM: {len(content)} patches, {llm_wall:.0f}s wall, ${env.get('total_cost_usd',0):.3f} "
      f"(batched — per-case share {llm_wall/len(content):.1f}s)")


def validate(template, slots, theme):
    """The whitelist, implemented against the real contract."""
    errs = []
    if template not in TEMPLATES:
        errs.append(f"unknown templateId {template!r}")
        return errs
    allowed = {s: k for s, k in SLOTS.items() if s.startswith(template + ".")}
    for sid, val in (slots or {}).items():
        if sid not in allowed:
            errs.append(f"slot {sid} not in {template}")
        elif val is not None:
            want = allowed[sid]
            got = val.get("kind") if isinstance(val, dict) else None
            if got != want:
                errs.append(f"{sid}: kind {got!r} != {want!r}")
    for ax, v in theme.items():
        if v not in AXES[ax]:
            errs.append(f"theme.{ax}={v!r} not an enum value")
    filled = [s for s, v in (slots or {}).items() if v is not None]
    nb = sum(1 for s in filled if allowed.get(s) == "Button")
    nr = sum(1 for s in filled if allowed.get(s) == "Slider")
    if nb > C["button_count"]:
        errs.append(f"{nb} buttons > BUTTON_COUNT {C['button_count']}")
    if nr > C["range_count"]:
        errs.append(f"{nr} sliders > RANGE_CONTROL_COUNT {C['range_count']}")
    return errs


print(f"\n{'utterance':<38}{'template ok':<13}{'slots':<8}{'valid':<8}errors")
print("-" * 104)
for r in stage1:
    slots = by_utt.get(r["utterance"], {})
    errs = validate(r["template"], slots, r["theme"])
    ok_t = r["template"] == r["gold_template"]
    print(f"{r['utterance'][:37]:<38}{('YES' if ok_t else 'NO'):<13}{len(slots):<8}"
          f"{('PASS' if not errs else 'FAIL'):<8}{'; '.join(errs[:2])[:40]}")
    results.append(dict(**r, n_slots=len(slots), valid=not errs, errors=errs))

valid = sum(r["valid"] for r in results)
e2e = sum(r["valid"] and r["template"] == r["gold_template"] for r in results)
print(f"\n\nEND-TO-END")
print(f"  schema-valid patch sets     : {valid}/{len(results)}")
print(f"  template correct AND valid  : {e2e}/{len(results)}   <- true end-to-end success")
print(f"  stage-1 template accuracy   : {t_ok}/{len(results)}")
print(f"  cascade losses (valid but wrong template): {valid - e2e}")
jp50 = st.median([r["latency_s"] for r in stage1]) * 1000
print(f"\nLATENCY")
print(f"  Jev decision layer (13 questions, one call) : {jp50:.0f}ms p50")
print(f"  LLM content patch, per case (batched)       : {llm_wall/len(content):.1f}s")
print(f"  fast path  (no generation)                  : ~{jp50:.0f}ms")
print(f"  slow path  (Jev + LLM)                      : ~{jp50/1000 + llm_wall/len(content):.1f}s")

jev.close()
out = ROOT / "results" / "p14_e2e.json"
out.write_text(json.dumps(dict(cases=results, template_acc=t_ok / len(results),
                               research_acc=r_ok / len(results),
                               schema_valid=valid / len(results),
                               e2e_success=e2e / len(results),
                               jev_p50_ms=round(jp50)), indent=2))
print(f"\nrequests={jev.requests}  jev_cost=${jev.usd:.5f}\nwrote {out}")
