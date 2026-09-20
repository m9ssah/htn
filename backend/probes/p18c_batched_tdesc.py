"""p18c -- the two variables p18b left uncontrolled: batching, and the
choice_cards description itself."""
import json, statistics as st, sys, time
from collections import Counter
from pathlib import Path
sys.path.insert(0, "/Users/steric/work/03-Projects/htn/htn/backend")
from jev.client import Jev, choice

C = json.loads(Path("/Users/steric/work/03-Projects/htn/htn/backend/schema_contract.json").read_text())
TEMPLATES = C["templates"]
BASE = {
 "choice_cards":"Choose between generated options; a slider scrubs the axis they vary on",
 "item_detail":"The chosen thing, whole, with quantities a slider can rescale",
 "focus_step":"One instruction at a time; sparse; encoder scrubs steps",
 "recovery":"Something went wrong: diagnosis, recommended fix, consequence",
 "summary_done":"The task is done; an open prompt, not a button row",
 "people_picker":"Pick people",
 "message_drafts":"Generated drafts, one per recipient, with a tone axis",
 "generic_answer":"Anything unscripted; answers a judge driving the device",
}
# narrow generic_answer so it stops acting as a catch-all, and make choice_cards
# own the "help me decide / what should I" opening explicitly.
FIXED = dict(BASE)
FIXED["choice_cards"] = ("The user is deciding WHAT to do and has not chosen yet -- "
                         "generated options to pick between; a slider scrubs the axis they vary on")
FIXED["generic_answer"] = ("A question that wants a factual ANSWER and no change to the task. "
                           "Not for choosing, not for starting something.")
ROUTES = {
 "new_task":"The user is starting a different task, or there is no task yet. What is on screen should be replaced.",
 "refine":"The same task, but the user wants the CURRENT surface presented differently -- bigger, clearer, denser, a different look. Nothing about the task itself changed.",
 "correct":"The user is reporting that something in the task went wrong or was done differently than planned -- a wrong amount, a mistake, a correction to what already happened.",
 "select":"The user is choosing one of the things currently on screen.",
 "query":"The user is asking a question. They want an answer, not a change to the task or to what is on screen.",
 "other":"None of the above fits.",
}
Q14="Which template should the interface switch to?"
CASES=[("what should I make tonight",None,"nothing started","choice_cards"),
 ("actually let's do something else","item_detail","chocolate chip cookies chosen","choice_cards"),
 ("who should I invite on Friday",None,"nothing started","people_picker"),
 ("how long does it bake","item_detail","cookies, not started","generic_answer"),
 ("is this recipe actually healthy","item_detail","cookies, not started","generic_answer"),
 ("how does this device work",None,"nothing started","generic_answer"),
 ("what's the weather like tomorrow","item_detail","cookies, not started","generic_answer"),
 ("text them the recipe","summary_done","cookies baked","people_picker"),
 ("start the first step","item_detail","cookies chosen","focus_step")]
ARMS={"D p14 wording + route batched (PRODUCTION shape)":(BASE,True),
      "E p14 wording + route batched + fixed TDESC":(FIXED,True)}
jev=Jev(); out={}
for arm,(tdesc,batched) in ARMS.items():
    rows,lat=[],[]
    for utt,cur,summary,gold in CASES:
        picks=[]
        for _ in range(3):
            qs={"templateId":choice(Q14,{t:tdesc[t] for t in TEMPLATES})}
            if batched: qs["route"]=choice("What is the user trying to do to the interface or the task right now?",ROUTES)
            t0=time.perf_counter()
            r=jev.evaluate({"utterance":utt,"currentTemplate":cur,"taskState":summary},qs)
            lat.append((time.perf_counter()-t0)*1000); picks.append(r.answers["templateId"].value)
        m=Counter(picks).most_common(1)[0][0]
        rows.append(dict(utterance=utt,gold=gold,picked=m,correct=m==gold,stable=len(set(picks))==1))
    acc=sum(r["correct"] for r in rows)
    out[arm]=dict(rows=rows,acc=acc,p50=round(st.median(lat)))
    print(f"{arm}\n  -> {acc}/9 correct, {sum(r['stable'] for r in rows)}/9 stable, p50 {out[arm]['p50']}ms")
    for r in rows:
        if not r["correct"]: print(f"     MISS {r['utterance'][:42]:44} got {r['picked']:15} want {r['gold']}")
    print()
Path("/Users/steric/work/03-Projects/htn/htn/backend/results/p18c_batched_tdesc.json").write_text(json.dumps(out,indent=1))
print("-> results/p18c_batched_tdesc.json")
