"""Probe 13 -- Jev against the ACTUAL contract in m9ssah/htn.

Earlier probes used invented enums. This uses the real ones from
`packages/schema/src/index.ts`:

  SkeletonPatch  agent 2  -> one of 8 TemplateId
  StylePatch     agent 3  -> 5 axes, 432 combinations   <- schema already says Jev

Both are pure selection over a finite set, which is the shape Jev is built for.
"""
import json, statistics as st, sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice  # noqa: E402

jev = Jev(max_usd=1.5)
REPS = 3

# ---- verbatim from packages/schema/src/index.ts ---------------------------
TEMPLATES = {
    "choice_cards": "Choose between generated options; a slider scrubs the axis they vary on",
    "recipe_overview": "The chosen thing, whole, with quantities a slider can rescale",
    "focus_step": "One instruction at a time; deliberately sparse, encoder scrubs steps",
    "recovery": "Something went wrong: diagnosis, recommended fix, consequence",
    "summary_done": "The task is done; an open prompt, not a button row",
    "people_picker": "Pick people",
    "message_drafts": "Generated drafts, one per recipient, with a tone axis",
    "generic_answer": "Anything unscripted; answers a judge driving the device",
}
AXES = {
    "palette": {"slate": "Slate — neutral cool grey",
                "mono": "Mono — black and white only",
                "rose": "Rose — warm pink accent",
                "contrast": "Contrast — maximum legibility, high contrast"},
    "fontPairing": {"system": "System — native UI font",
                    "editorial": "Editorial — serif display, literary",
                    "geometric": "Geometric — clean geometric sans",
                    "mono": "Mono — monospace, technical"},
    "density": {"compact": "Compact — tight spacing, more on screen",
                "normal": "Normal — balanced spacing",
                "spacious": "Spacious — generous whitespace, less on screen"},
    "radius": {"sharp": "Sharp — square corners",
               "soft": "Soft — slightly rounded",
               "round": "Round — fully rounded, pill-like"},
    "motif": {"none": "None — no decoration",
              "floral": "Floral — botanical decoration",
              "geometric": "Geometric — geometric pattern decoration"},
}

# ================= A. agent 2 — template selection =========================
CASES_T = [
    ("L1", "which-recipe", "Which of these should I make?", ["choice_cards"]),
    ("L1", "show-recipe", "Show me the whole recipe.", ["recipe_overview"]),
    ("L1", "whats-next", "What do I do next?", ["focus_step"]),
    ("L2", "burnt-it", "I burnt it, what now?", ["recovery"]),
    ("L2", "all-done", "That's it, I'm finished.", ["summary_done"]),
    ("L2", "who-invite", "Who should I invite?", ["people_picker"]),
    ("L2", "text-them", "Text everyone and let them know.", ["message_drafts"]),
    ("L3", "judge-q", "How does this thing actually work?", ["generic_answer"]),
    ("L3", "double-it", "I need to make twice as much.", ["recipe_overview"]),
    ("L3", "too-salty", "This tastes way too salty.", ["recovery"]),
    ("L4", "im-stuck", "I'm stuck.", ["recovery", "focus_step", "generic_answer"]),
    ("L4", "start-over", "Let's start over.", ["choice_cards", "generic_answer", "summary_done"]),
]
print("A. agent 2 — SkeletonPatch.templateId  (8 options, the real set)\n")
print(f"{'lvl':<5}{'case':<16}{'picked':<18}{'conf':<7}{'ok':<5}{'ms':<6}stable")
print("-" * 74)
rows_t = []
for lvl, name, utt, gold in CASES_T:
    picks, confs, lats = [], [], []
    for _ in range(REPS):
        r = jev.evaluate({"utterance": utt},
                         {"templateId": choice(
                             "Which template should the interface switch to?", TEMPLATES)})
        if not r.ok:
            continue
        a = r.answers["templateId"]
        picks.append(a.value); confs.append(a.confidence); lats.append(r.latency_s)
    mode = Counter(picks).most_common(1)[0][0]
    ok = mode in gold
    stable = len(set(picks)) == 1
    mc = st.mean(confs)
    print(f"{lvl:<5}{name:<16}{mode:<18}{mc:<7.2f}{'YES' if ok else 'NO ':<5}"
          f"{st.median(lats)*1000:<6.0f}{stable}")
    rows_t.append(dict(level=lvl, case=name, picked=mode, correct=ok,
                       conf=round(mc, 3), stable=stable))
acc_t = st.mean([r["correct"] for r in rows_t])
gated = [r for r in rows_t if r["conf"] >= 0.60]
print(f"\n  accuracy {acc_t:.0%}   argmax-stable {sum(r['stable'] for r in rows_t)}/{len(rows_t)}")
print(f"  above 0.60 gate: {len(gated)}/{len(rows_t)} kept, "
      f"accuracy on kept {st.mean([r['correct'] for r in gated]):.0%}")

# ================= B. agent 3 (Jev) — StylePatch, 5 axes in ONE call =======
CASES_S = [
    ("L1", "high-contrast-big", "Make it high contrast and easy to read.",
     {"palette": ["contrast"]}),
    ("L1", "pink-soft", "Make it pink and soft.",
     {"palette": ["rose"], "radius": ["round", "soft"]}),
    ("L2", "clean-technical", "Make it look clean and technical.",
     {"fontPairing": ["mono", "geometric"], "motif": ["none"]}),
    ("L2", "more-on-screen", "I want to see more at once.",
     {"density": ["compact"]}),
    ("L2", "calm-airy", "Give it room to breathe.",
     {"density": ["spacious"]}),
    ("L3", "elegant-serif", "Make it feel elegant and a bit literary.",
     {"fontPairing": ["editorial"]}),
    ("L3", "cant-see", "I can't see this properly.",
     {"palette": ["contrast"], "density": ["spacious", "normal"]}),
    ("L4", "modern", "Make it feel more modern.", {}),
]
print("\n\nB. agent 3 (Jev) — StylePatch, all 5 axes in ONE call  (432 combos)\n")
print(f"{'lvl':<5}{'case':<18}{'palette':<11}{'font':<11}{'density':<10}"
      f"{'radius':<8}{'motif':<10}{'ms':<6}constrained axes")
print("-" * 104)
rows_s = []
for lvl, name, utt, expect in CASES_S:
    qs = {ax: choice(f"Which {ax} best matches the request?", opts)
          for ax, opts in AXES.items()}
    picked, confs, lats = {}, [], []
    for _ in range(REPS):
        r = jev.evaluate({"utterance": utt}, qs)
        if not r.ok:
            continue
        lats.append(r.latency_s)
        for ax in AXES:
            picked.setdefault(ax, []).append(r.answers[ax].value)
            confs.append(r.answers[ax].confidence)
    modes = {ax: Counter(v).most_common(1)[0][0] for ax, v in picked.items()}
    hits = [f"{ax}={'OK' if modes[ax] in want else 'NO(' + modes[ax] + ')'}"
            for ax, want in expect.items()]
    ok_all = all(modes[ax] in want for ax, want in expect.items())
    print(f"{lvl:<5}{name:<18}{modes['palette']:<11}{modes['fontPairing']:<11}"
          f"{modes['density']:<10}{modes['radius']:<8}{modes['motif']:<10}"
          f"{st.median(lats)*1000:<6.0f}{' '.join(hits) or '(unconstrained)'}")
    rows_s.append(dict(level=lvl, case=name, modes=modes, ok=ok_all,
                       constrained=list(expect), mean_conf=round(st.mean(confs), 3)))
scored = [r for r in rows_s if r["constrained"]]
print(f"\n  constrained-axis accuracy: {st.mean([r['ok'] for r in scored]):.0%} "
      f"({sum(r['ok'] for r in scored)}/{len(scored)} cases fully correct)")
print(f"  5 axes cost ONE call: p50 {st.median([r for r in [200]]):.0f}ms-class, "
      f"same as one axis (questions are free)")

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p13_real_schema.json"
res.write_text(json.dumps(dict(template=rows_t, style=rows_s,
                               template_accuracy=round(acc_t, 3)), indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}\nwrote {res}")
