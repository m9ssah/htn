"""Probe 9 -- can ONE static candidate list serve many different requests?

Jev cannot generate research candidates; it can only filter a list you wrote.
That is only a real limitation if the list must be tailored per request. If a
single universal list works across unrelated requests, you author it once and
"Jev decides what to research" becomes true in practice.

Also tests the failure mode that matters: when the list OMITS the one thing
that actually matters, does Jev signal anything, or silently return a confident
subset of an inadequate list?
"""
import json, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jev.client import Jev, noul  # noqa: E402

jev = Jev(max_usd=1.0)

# One list, authored once, deliberately spanning far more ground than any single
# request needs -- 30 items.
UNIVERSAL = {
    "theme_arch": "Existing theme / styling architecture",
    "color_tokens": "Design-system colour token definitions",
    "persistence": "How user preferences are persisted",
    "system_pref": "Whether OS-level preferences are read",
    "settings_arch": "How the settings screen is structured",
    "component_lib": "Which component library is in use",
    "css_approach": "CSS approach (modules, utility, CSS-in-JS)",
    "a11y_target": "Accessibility conformance target",
    "i18n_setup": "Existing internationalisation setup",
    "copy_source": "Where user-facing copy lives",
    "rtl_support": "Right-to-left layout support",
    "locale_detect": "How locale is detected",
    "payment_provider": "Which payment provider is integrated",
    "pricing_model": "Current pricing and plan structure",
    "tax_handling": "How tax and VAT are handled",
    "pci_scope": "PCI compliance scope",
    "subscription_state": "How subscription state is stored",
    "db_schema": "Database schema for the affected entities",
    "api_surface": "Existing API endpoints and contracts",
    "auth_model": "Authentication and session model",
    "permissions": "Authorisation / role model",
    "data_volume": "Expected data volume and growth",
    "caching": "Existing caching layers",
    "realtime_infra": "Websocket / polling infrastructure",
    "metrics_source": "Where product metrics are stored",
    "chart_lib": "Charting library already in use",
    "refresh_policy": "Existing data refresh conventions",
    "error_states": "Established loading and error-state patterns",
    "test_setup": "Test framework and conventions",
    "deploy_target": "Deployment platform and constraints",
}

REQUESTS = {
    "dark mode": {"theme_arch", "color_tokens", "persistence", "system_pref",
                  "settings_arch", "css_approach", "a11y_target", "component_lib"},
    "translate the UI into French": {"i18n_setup", "copy_source", "rtl_support",
                                     "locale_detect", "component_lib"},
    "add subscription billing": {"payment_provider", "pricing_model", "tax_handling",
                                 "pci_scope", "subscription_state", "db_schema",
                                 "api_surface", "auth_model"},
    "live metrics dashboard refreshing every minute": {
        "metrics_source", "chart_lib", "refresh_policy", "error_states",
        "realtime_infra", "api_surface", "data_volume", "caching"},
}

print(f"A. ONE static list of {len(UNIVERSAL)} items, four unrelated requests\n")
print(f"{'request':<46}{'prec':<8}{'recall':<9}{'F1':<8}{'ms':<7}errors")
print("-" * 100)
out = []
for req, gold_keys in REQUESTS.items():
    qs = {k: noul(f"Must this be investigated before implementing the request? Item: {v}",
                  true="Not knowing this could make the implementation wrong or need rework",
                  false="Unrelated to this request, or useful background at most")
          for k, v in UNIVERSAL.items()}
    r = jev.evaluate({"user_request": req, "candidates": UNIVERSAL}, qs)
    picked = {k for k, a in r.answers.items() if a.value >= 0.5}
    tp = len(picked & gold_keys)
    prec = tp / len(picked) if picked else 1.0
    rec = tp / len(gold_keys)
    f1 = 0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)
    errs = [f"+{k}" for k in sorted(picked - gold_keys)] + \
           [f"-{k}" for k in sorted(gold_keys - picked)]
    print(f"{req:<46}{prec:<8.2f}{rec:<9.2f}{f1:<8.2f}{r.latency_s*1000:<7.0f}"
          f"{' '.join(errs[:4])}")
    out.append(dict(request=req, precision=round(prec, 3), recall=round(rec, 3),
                    f1=round(f1, 3), n_picked=len(picked), errors=errs))

print(f"\n  mean F1 across four unrelated requests: "
      f"{st.mean([o['f1'] for o in out]):.3f}")
print(f"  (a per-request tailored list of 12 scored 1.00 in probe 7)")

# --- B. does it notice when the list is inadequate? -------------------------
print("\n\nB. list OMITS the critical item -- does Jev signal, or answer confidently anyway?\n")
CRIPPLED = {k: UNIVERSAL[k] for k in
            ["test_setup", "deploy_target", "chart_lib", "caching", "data_volume"]}
qs = {k: noul(f"Must this be investigated before implementing the request? Item: {v}",
              true="Not knowing this could make the implementation wrong or need rework",
              false="Unrelated to this request, or useful background at most")
      for k, v in CRIPPLED.items()}
qs["list_sufficient"] = noul(
    "Does the `candidates` list cover everything that must be investigated for this request?",
    true="Every investigation the request needs appears in the list",
    false="Something essential to this request is missing from the list")
r = jev.evaluate({"user_request": "add subscription billing with Stripe",
                  "candidates": CRIPPLED}, qs)
picked = [k for k, a in r.answers.items() if k != "list_sufficient" and a.value >= 0.5]
suff = r.answers["list_sufficient"].value
print(f"  request      : add subscription billing with Stripe")
print(f"  list given   : {list(CRIPPLED)}  (nothing about payments)")
print(f"  Jev selected : {picked or '(nothing)'}")
print(f"  'list is sufficient' -> {suff:.3f}   {'CORRECT: flags the gap' if suff < 0.5 else 'MISSES the gap'}")

jev.close()
res = Path(__file__).resolve().parents[1] / "results" / "p09_universal_list.json"
res.write_text(json.dumps(dict(universal=out, crippled=dict(
    selected=picked, list_sufficient=round(suff, 3))), indent=2))
print(f"\nwrote {res}")
