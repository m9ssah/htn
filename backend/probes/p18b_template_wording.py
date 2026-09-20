"""p18b -- isolate the templateId regression p18 introduced.

p18 graded `route` and reported `templateId` only as "stable". Grading it
afterwards showed 6 of the 7 honoured (new_task|query) cases returned
`generic_answer`, including the demo opener "what should I make tonight" --
which p14 answered `choice_cards` from the same schema.

Two things differ between p14 and p18, both mine:
  wording  p14 "Which template should the interface switch to?"
           p18 "If the interface were to switch to a new layout, which one fits?"
  state    p14 utterance only
           p18 + currentTemplate + taskState ("nothing started")

Three arms, same cases, so the cause is attributable rather than guessed:
  A  p14 wording, p18 state      -> isolates WORDING
  B  p18 wording, p18 state      -> reproduces p18
  C  p14 wording, utterance only -> isolates STATE
"""
import json, statistics as st, sys, time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice  # noqa: E402

C = json.loads((Path(__file__).resolve().parents[1] / "schema_contract.json").read_text())
TEMPLATES = C["templates"]

TDESC = {
    "choice_cards": "Choose between generated options; a slider scrubs the axis they vary on",
    "item_detail": "The chosen thing, whole, with quantities a slider can rescale",
    "focus_step": "One instruction at a time; sparse; encoder scrubs steps",
    "recovery": "Something went wrong: diagnosis, recommended fix, consequence",
    "summary_done": "The task is done; an open prompt, not a button row",
    "people_picker": "Pick people",
    "message_drafts": "Generated drafts, one per recipient, with a tone axis",
    "generic_answer": "Anything unscripted; answers a judge driving the device",
}
Q14 = "Which template should the interface switch to?"
Q18 = "If the interface were to switch to a new layout, which one fits?"

# Only the honoured branch matters: these are the cases where Jev's templateId
# is what actually paints. gold_template authored here, stated as not held out.
CASES = [
    ("what should I make tonight",        None, "nothing started",              "choice_cards"),
    ("actually let's do something else",  "item_detail", "chocolate chip cookies chosen", "choice_cards"),
    ("who should I invite on Friday",     None, "nothing started",              "people_picker"),
    ("how long does it bake",             "item_detail", "cookies, not started", "generic_answer"),
    ("is this recipe actually healthy",   "item_detail", "cookies, not started", "generic_answer"),
    ("how does this device work",         None, "nothing started",              "generic_answer"),
    ("what's the weather like tomorrow",  "item_detail", "cookies, not started", "generic_answer"),
    ("text them the recipe",              "summary_done", "cookies baked",       "people_picker"),
    ("start the first step",              "item_detail", "cookies chosen",       "focus_step"),
]
ARMS = {"A wording=p14 state=full": (Q14, True),
        "B wording=p18 state=full": (Q18, True),
        "C wording=p14 state=utt ": (Q14, False)}
REPS = 3

jev = Jev()
print(f"{len(CASES)} cases x {len(ARMS)} arms x {REPS} reps\n")
out = {}
for arm, (qtext, full_state) in ARMS.items():
    rows, lat = [], []
    for utt, cur, summary, gold in CASES:
        picks = []
        for _ in range(REPS):
            qs = {"templateId": choice(qtext, {t: TDESC[t] for t in TEMPLATES})}
            state = {"utterance": utt, "currentTemplate": cur, "taskState": summary} \
                    if full_state else {"utterance": utt}
            t0 = time.perf_counter()
            r = jev.evaluate(state, qs)
            lat.append((time.perf_counter() - t0) * 1000)
            picks.append(r.answers["templateId"].value)
        mode = Counter(picks).most_common(1)[0][0]
        rows.append(dict(utterance=utt, gold=gold, picked=mode,
                         correct=mode == gold, stable=len(set(picks)) == 1))
    acc = sum(r["correct"] for r in rows)
    out[arm] = dict(rows=rows, acc=acc, p50=round(st.median(lat)))
    print(f"{arm}  ->  {acc}/{len(CASES)} correct, "
          f"{sum(r['stable'] for r in rows)}/{len(CASES)} stable, p50 {out[arm]['p50']}ms")
    for r in rows:
        if not r["correct"]:
            print(f"     MISS  {r['utterance'][:42]:44} got {r['picked']:15} want {r['gold']}")
    print()

Path("results/p18b_template_wording.json").write_text(json.dumps(out, indent=1))
print("-> results/p18b_template_wording.json")
