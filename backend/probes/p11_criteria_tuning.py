"""Probe 11 -- is the low recall in probe 10 Jev's ceiling, or my wording again?

Probe 10 got precision 1.00 / recall 0.17-0.33 on both corrected nodes. That is
the same signature probe 6 already traced to criteria wording, not the model.
Same cases, three wordings, strict -> intent-aware.
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul  # noqa: E402

jev = Jev(max_usd=1.5)
REPS = 3

SOURCES = {
    "product_title": "DOM: the product title heading",
    "product_price": "DOM: the current displayed price",
    "price_history": "API /api/price-history: past 90 days of prices",
    "stock_level": "API /api/inventory: units in stock",
    "reviews_list": "DOM: the customer review list",
    "review_summary": "API /api/reviews/summary: rating and count",
    "seller_name": "DOM: the seller's display name",
    "seller_rating": "API /api/seller: seller rating and history",
    "shipping_cost": "API /api/shipping: cost to the user's address",
    "related_items": "DOM: the 'customers also bought' carousel",
    "page_meta": "DOM: page title and meta description",
    "cookie_banner": "DOM: the cookie consent banner text",
}
FETCH_CASES = [
    ("trustworthy-seller", "Can I trust this seller?",
     {"seller_name", "seller_rating", "review_summary"}),
    ("should-i-buy", "Should I buy this?",
     {"product_price", "price_history", "review_summary", "stock_level", "seller_rating"}),
    ("whats-the-catch", "What's the catch with this one?",
     {"reviews_list", "review_summary", "shipping_cost", "seller_rating"}),
]
FETCH_WORDINGS = {
    "w1 strict (probe 10)": dict(
        t="The request cannot be answered without this data",
        f="This data is irrelevant to the request, or merely nice to have"),
    "w2 supporting": dict(
        t="This data would inform the answer, directly or as supporting evidence",
        f="This data has no bearing on the request"),
    "w3 answer-shaped": dict(
        t="A thorough answer to the request would draw on this data. The user asked a "
          "judgement question, so gather everything that bears on the judgement.",
        f="Unrelated to the request"),
}

COMPONENTS = {
    "timeline": "Timeline panel (visible)", "effects_panel": "Effects panel (visible)",
    "properties": "Properties inspector (visible)", "media_library": "Media library (visible)",
    "export_settings": "Export settings panel (visible)", "toolbar": "Main toolbar (visible)",
    "preview": "Video preview (visible)", "captions_editor": "Captions editor (hidden)",
    "audio_mixer": "Audio mixer (hidden)",
}
COMP_CASES = [
    ("just-trim", "I just want to trim this clip.",
     {"effects_panel", "properties", "media_library", "export_settings",
      "captions_editor", "audio_mixer"}),
    ("add-captions", "I'm adding captions now.",
     {"captions_editor", "effects_panel", "properties", "export_settings",
      "audio_mixer", "media_library"}),
    ("too-cluttered", "This is too cluttered.",
     {"effects_panel", "properties", "media_library", "export_settings",
      "captions_editor", "audio_mixer"}),
]
COMP_WORDINGS = {
    "w1 strict (probe 10)": dict(
        t="The request requires this component's visibility or configuration to change",
        f="This component should be left exactly as it is"),
    "w2 task-focus": dict(
        t="This component is NOT needed for the task the user stated, so it should be "
          "hidden to focus the interface",
        f="This component is needed for the stated task and must stay visible"),
    "w3 explicit-subset": dict(
        t="The user named one task. Keep only what that task needs. This component is "
          "not required for it, so its visibility must change.",
        f="This component is required for the stated task, or is essential chrome"),
}


def sweep(label, pool, cases, wordings, qtext):
    print(f"\n{label}")
    print(f"  {'wording':<24}{'precision':<12}{'recall':<10}{'F1':<8}per-case F1")
    print("  " + "-" * 74)
    best = None
    for wname, w in wordings.items():
        ps, rs, fs, per = [], [], [], []
        for cname, req, gold in cases:
            qs = {k: noul(qtext.format(v=v), true=w["t"], false=w["f"])
                  for k, v in pool.items()}
            f1s = []
            for _ in range(REPS):
                r = jev.evaluate({"user_request": req, "available": pool}, qs)
                if not r.ok:
                    continue
                picked = {k for k, a in r.answers.items() if a.value >= 0.5}
                tp = len(picked & gold)
                p = tp / len(picked) if picked else 1.0
                rc = tp / len(gold)
                f1s.append(0 if p + rc == 0 else 2 * p * rc / (p + rc))
                ps.append(p); rs.append(rc)
            per.append(st.mean(f1s) if f1s else 0.0)
        f1 = st.mean(per)
        print(f"  {wname:<24}{st.mean(ps):<12.2f}{st.mean(rs):<10.2f}{f1:<8.2f}"
              f"{[round(x,2) for x in per]}")
        if best is None or f1 > best[1]:
            best = (wname, f1)
    print(f"  --> best: {best[0]}  F1 {best[1]:.2f}")
    return best


b1 = sweep("A. FUNCTIONAL ACTION = grab data from the website", SOURCES, FETCH_CASES,
           FETCH_WORDINGS, "Should this be fetched to answer the request? Source: {v}")
b2 = sweep("B. UPDATE SETTING = update UI components", COMPONENTS, COMP_CASES,
           COMP_WORDINGS, "Must this component change to satisfy the request? Component: {v}")

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p11_criteria_tuning.json"
res.write_text(json.dumps({"grab_data_best": b1, "ui_components_best": b2}, indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}\nwrote {res}")
