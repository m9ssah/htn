"""Probe 18 -- the route question, with state. The spine that was never measured.

Every probe before this asked `templateId` from the utterance alone. The
orchestration plan puts a 5-way route decision UPSTREAM of the template answer
and uses it to decide whether the template answer is even applied:

    new_task | query  -> honour Jev's templateId
    refine   | correct-> keep the CURRENT template
    select            -> deterministic from the touched action

Nothing has ever asked that question. p14's question set is templateId + 5 axes
+ 2 nouls; grep the probe directory for a route question and it is empty.

Two things measured here:

  1. Route accuracy, its confusion pairs, and whether confidence separates a
     right answer from a wrong one (p13 found it does NOT for templateId:
     wrong at 0.723 sitting above correct at 0.317).
  2. Whether adding route to the batch DEGRADES templateId. That is the real
     risk of one wide call, and it is free to test by asking both here.

Route is unanswerable from the utterance alone -- "the second one" is only a
selection if something is on screen -- so state carries currentTemplate and a
short task summary, which is what the running system would have.
"""
import json, statistics as st, sys, time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "schema_contract.json").read_text())
TEMPLATES = C["templates"]

TDESC = {
    "choice_cards": "Choose between generated options; a slider scrubs the axis they vary on",
    "item_detail": "The chosen thing, whole, with quantities a slider can rescale",
    "focus_step": "One instruction at a time; deliberately sparse",
    "recovery": "Something went wrong: diagnosis, recommended fix, consequence",
    "summary_done": "The task is done; an open prompt, not a button row",
    "people_picker": "Pick people",
    "message_drafts": "Generated drafts, one per recipient, with a tone axis",
    "generic_answer": "Anything unscripted; answers a question without changing the task",
}

ROUTES = {
    "new_task": "The user is starting a different task, or there is no task yet. "
                "What is on screen should be replaced.",
    "refine":   "The same task, but the user wants the CURRENT surface presented "
                "differently -- bigger, clearer, denser, a different look. Nothing "
                "about the task itself changed.",
    "correct":  "The user is reporting that something in the task went wrong or was "
                "done differently than planned -- a wrong amount, a mistake, a "
                "correction to what already happened.",
    "select":   "The user is choosing one of the things currently on screen.",
    "query":    "The user is asking a question. They want an answer, not a change "
                "to the task or to what is on screen.",
    "other":    "None of the above fits.",
}

# (utterance, currentTemplate, task summary, gold route)
CASES = [
    ("what should I make tonight",              None,            "nothing started",                     "new_task"),
    ("actually let's do something else",        "item_detail",   "cookie recipe open, nothing in bowl", "new_task"),
    ("who should I invite on Friday",           "item_detail",   "cookie recipe open",                  "new_task"),

    ("make it high contrast, I can't read this","item_detail",   "cookie recipe open",                  "refine"),
    ("make the text bigger",                    "focus_step",    "step 2 of 6",                         "refine"),
    ("show me fewer steps at a time",           "focus_step",    "step 2 of 6",                         "refine"),

    ("I put in too much sugar",                 "focus_step",    "step 3 of 6, flour+butter in bowl",   "correct"),
    ("I burnt the sauce",                       "focus_step",    "step 5 of 6",                         "correct"),
    ("actually it was three times, not twice",  "recovery",      "over-added sugar 2x, fix proposed",   "correct"),

    ("the second one",                          "choice_cards",  "3 recipe options on screen",          "select"),
    ("the chocolate chip one",                  "choice_cards",  "3 recipe options on screen",          "select"),
    ("yeah that one",                           "people_picker", "3 contacts on screen",                "select"),

    ("how long does it bake",                   "item_detail",   "cookie recipe open",                  "query"),
    ("is this recipe actually healthy",         "item_detail",   "cookie recipe open",                  "query"),
    ("how does this device work",               "item_detail",   "cookie recipe open",                  "query"),
    ("what's the weather like tomorrow",        "item_detail",   "cookie recipe open",                  "query"),
]
REPS = 3

jev = Jev(max_usd=1.00)
rows = []

print(f"{len(CASES)} cases x {REPS} reps, route + templateId in ONE call\n")
print(f"{'utterance':<40}{'gold':<10}{'picked':<10}{'conf':<7}{'template':<16}{'ms'}")
print("-" * 92)

for utt, cur, summary, gold in CASES:
    picks, confs, tmpls, lats = [], [], [], []
    for _ in range(REPS):
        qs = {
            "route": choice(
                "What is the user trying to do to the interface or the task right now?",
                ROUTES),
            "templateId": choice(
                "If the interface were to switch to a new layout, which one fits?",
                {t: TDESC[t] for t in TEMPLATES}),
        }
        state = {"utterance": utt, "currentTemplate": cur, "taskState": summary}
        t0 = time.perf_counter()
        r = jev.evaluate(state, qs)
        lats.append(time.perf_counter() - t0)
        picks.append(r.answers["route"].value)
        confs.append(r.answers["route"].confidence)
        tmpls.append(r.answers["templateId"].value)
    mode = Counter(picks).most_common(1)[0][0]
    rows.append(dict(utterance=utt, currentTemplate=cur, taskState=summary,
                     gold=gold, picked=mode, correct=mode == gold,
                     stable=len(set(picks)) == 1,
                     conf=round(st.mean(confs), 3),
                     modes=dict(Counter(picks)),
                     template=Counter(tmpls).most_common(1)[0][0],
                     template_stable=len(set(tmpls)) == 1,
                     p50_ms=round(st.median(lats) * 1000)))
    f = rows[-1]
    mark = " " if f["correct"] else "X"
    print(f"{utt[:39]:<40}{gold:<10}{f['picked']:<10}{f['conf']:<7.2f}"
          f"{f['template']:<16}{f['p50_ms']}{mark}")

ok = [r for r in rows if r["correct"]]
bad = [r for r in rows if not r["correct"]]
print(f"\nROUTE  {len(ok)}/{len(rows)}   stable {sum(r['stable'] for r in rows)}/{len(rows)}"
      f"   p50 {st.median([r['p50_ms'] for r in rows])}ms   2 questions/call")

per = Counter()
for r in rows:
    per[r["gold"]] += 1
correct_per = Counter(r["gold"] for r in ok)
print("\nper route:", "  ".join(f"{k} {correct_per[k]}/{per[k]}" for k in
      ["new_task", "refine", "correct", "select", "query"]))

if bad:
    print("\nconfusions:")
    for r in bad:
        print(f"  {r['utterance'][:40]:<42} {r['gold']} -> {r['picked']}  conf {r['conf']:.2f}")

print("\nCONFIDENCE SEPARATION (the p13 question)")
if ok and bad:
    lo_ok, hi_bad = min(r["conf"] for r in ok), max(r["conf"] for r in bad)
    print(f"  lowest correct  {lo_ok:.3f}")
    print(f"  highest wrong   {hi_bad:.3f}")
    print(f"  -> {'SEPARATES — a gate at %.2f works' % ((lo_ok + hi_bad) / 2) if lo_ok > hi_bad else 'DOES NOT separate — no threshold works, same as templateId'}")
else:
    print(f"  all {'correct' if not bad else 'wrong'} — no separation to measure")

print("\nDID ADDING ROUTE DEGRADE templateId?")
print(f"  templateId stable across reps: {sum(r['template_stable'] for r in rows)}/{len(rows)}")
print("  (p14 asked templateId alone in an 8-question call and got 8/8 on its own gold set;")
print("   this asks it beside route, so instability here is the batching cost.)")

out = ROOT / "results" / "p18_route.json"
out.write_text(json.dumps(rows, indent=2))
print(f"\nspend ${jev.usd:.4f}   ->  {out}")
