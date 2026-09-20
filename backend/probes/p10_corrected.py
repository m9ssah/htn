"""Probe 10 -- the bottom-half boxes under their ACTUAL semantics.

Earlier probes tested:
  Functional Action  as "pick an app action"      -> really: GRAB DATA from the page
  Update Setting     as "change user preferences" -> really: UPDATE UI COMPONENTS

Both were the wrong object. Retested here.
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, choice, noul  # noqa: E402

jev = Jev(max_usd=1.0)
REPS = 3
rows = []


def run(node, level, name, state, questions, gold, mode="labels"):
    accs, lats, det = [], [], ""
    for _ in range(REPS):
        r = jev.evaluate(state, questions)
        if not r.ok:
            det = f"ERR {r.error[:50]}"; accs.append(0); continue
        lats.append(r.latency_s)
        if mode == "choice":
            a = next(iter(r.answers.values()))
            accs.append(1.0 if a.value in gold else 0.0)
            det = f"picked={a.value} conf={a.confidence:.2f}"
        else:
            tp = fp = fn = 0; errs = []
            for k, want in gold.items():
                got = r.answers[k].value >= 0.5
                if got and want: tp += 1
                elif got and not want: fp += 1; errs.append(f"+{k}")
                elif not got and want: fn += 1; errs.append(f"-{k}")
            prec = tp / (tp + fp) if tp + fp else 1.0
            rec = tp / (tp + fn) if tp + fn else 1.0
            accs.append(0 if prec + rec == 0 else 2 * prec * rec / (prec + rec))
            det = f"P={prec:.2f} R={rec:.2f} {' '.join(errs[:3])}"
    f1 = st.mean(accs); ms = st.median(lats) * 1000 if lats else 0
    rows.append(dict(node=node, level=level, case=name, f1=round(f1, 3),
                     p50_ms=round(ms), detail=det))
    print(f"{node:<26}{level:<5}{name:<20}{f1:<7.2f}{ms:<7.0f}{det[:44]}")


print(f"{'node':<26}{'lvl':<5}{'case':<20}{'F1':<7}{'ms':<7}detail")
print("-" * 100)

# ============ A. FUNCTIONAL ACTION = grab data from the website =============
# Enumerable: the page's available data sources. Jev picks WHICH to fetch;
# the fetching itself is code.
SOURCES = {
    "product_title":   "DOM: the product title heading",
    "product_price":   "DOM: the current displayed price",
    "price_history":   "API /api/price-history: past 90 days of prices",
    "stock_level":     "API /api/inventory: units in stock",
    "reviews_list":    "DOM: the customer review list",
    "review_summary":  "API /api/reviews/summary: rating and count",
    "seller_name":     "DOM: the seller's display name",
    "seller_rating":   "API /api/seller: seller rating and history",
    "shipping_cost":   "API /api/shipping: cost to the user's address",
    "related_items":   "DOM: the 'customers also bought' carousel",
    "page_meta":       "DOM: page title and meta description",
    "cookie_banner":   "DOM: the cookie consent banner text",
}
FETCH_TRUE = "The request cannot be answered without this data"
FETCH_FALSE = "This data is irrelevant to the request, or merely nice to have"


def fetch(level, name, req, gold_keys):
    run("FnAction: grab data", level, name,
        {"user_request": req, "available_sources": SOURCES},
        {k: noul(f"Must this be fetched to answer the request? Source: {v}",
                 true=FETCH_TRUE, false=FETCH_FALSE) for k, v in SOURCES.items()},
        {k: (k in gold_keys) for k in SOURCES})


fetch("L1", "whats-the-price", "What's the price of this?", {"product_price"})
fetch("L2", "good-deal", "Is this a good deal right now?",
      {"product_price", "price_history"})
fetch("L2", "trustworthy-seller", "Can I trust this seller?",
      {"seller_name", "seller_rating", "review_summary"})
fetch("L3", "total-to-my-door", "What will this actually cost me delivered, and is it in stock?",
      {"product_price", "shipping_cost", "stock_level"})
fetch("L3", "should-i-buy", "Should I buy this?",
      {"product_price", "price_history", "review_summary", "stock_level", "seller_rating"})
fetch("L4", "whats-the-catch", "What's the catch with this one?",
      {"reviews_list", "review_summary", "shipping_cost", "seller_rating"})

# ============ B. UPDATE SETTING = update UI components ======================
COMPONENTS = {
    "timeline":        "Timeline panel (visible, height 240px)",
    "effects_panel":   "Effects panel (visible, right dock)",
    "properties":      "Properties inspector (visible, right dock)",
    "media_library":   "Media library (visible, left dock)",
    "export_settings": "Export settings panel (visible, modal)",
    "toolbar":         "Main toolbar (visible, top)",
    "preview":         "Video preview (visible, centre)",
    "captions_editor": "Captions editor (hidden)",
    "audio_mixer":     "Audio mixer (hidden)",
}
CH_TRUE = "The request requires this component's visibility or configuration to change"
CH_FALSE = "This component should be left exactly as it is"


def comp_update(level, name, req, gold_keys):
    run("UpdateSetting: UI comps", level, name,
        {"user_request": req, "current_components": COMPONENTS},
        {k: noul(f"Must this component change to satisfy the request? Component: {v}",
                 true=CH_TRUE, false=CH_FALSE) for k, v in COMPONENTS.items()},
        {k: (k in gold_keys) for k in COMPONENTS})


comp_update("L1", "hide-effects", "Hide the effects panel.", {"effects_panel"})
comp_update("L2", "just-trim", "I just want to trim this clip.",
            {"effects_panel", "properties", "media_library", "export_settings",
             "captions_editor", "audio_mixer"})
comp_update("L2", "add-captions", "I'm adding captions now.",
            {"captions_editor", "effects_panel", "properties", "export_settings",
             "audio_mixer", "media_library"})
comp_update("L3", "bigger-preview", "Make the preview bigger without hiding the timeline.",
            {"preview", "effects_panel", "properties", "media_library"})
comp_update("L4", "too-cluttered", "This is too cluttered.",
            {"effects_panel", "properties", "media_library", "export_settings",
             "captions_editor", "audio_mixer"})

# ============ C. MAKE UI = choose the UI (already validated) ================
SKELETONS = {
    "trim_minimal":  "Trim view: preview + timeline + in/out handles only",
    "caption_view":  "Caption view: preview + caption list + text editor",
    "color_grade":   "Colour view: preview + scopes + colour wheels",
    "audio_view":    "Audio view: waveform + mixer + levels",
    "export_view":   "Export view: format, resolution, destination",
    "full_editor":   "Full editor: every panel visible",
    "other":         "None of these fit",
}
for lvl, nm, req, gold in [
    ("L1", "trim-clip", "I just want to trim this clip.", ["trim_minimal"]),
    ("L2", "add-subs", "I need to add subtitles.", ["caption_view"]),
    ("L3", "too-dark", "The footage looks too dark.", ["color_grade"]),
    ("L4", "post-tiktok", "I want to post this to TikTok.",
     ["export_view", "trim_minimal", "full_editor"]),
]:
    run("MakeUI: choose the UI", lvl, nm, {"user_request": req},
        {"skeleton": choice("Which UI layout best fits the request?", SKELETONS)},
        gold, mode="choice")

print("\n\nPER-NODE")
from collections import defaultdict
by = defaultdict(list)
for r in rows:
    by[r["node"]].append(r)
for node, rs in by.items():
    print(f"  {node:<26} F1 {st.mean([x['f1'] for x in rs]):.2f}   "
          f"p50 {st.median([x['p50_ms'] for x in rs]):.0f}ms   (n={len(rs)})")

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p10_corrected.json"
res.write_text(json.dumps(rows, indent=2))
print(f"\nrequests={jev.requests}  cost=${jev.usd:.5f}\nwrote {res}")
