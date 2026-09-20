"""Gold-labelled cases for the node-suitability probe.

Each case names the node it stands for, a difficulty level L1-L4, the Jev
request, and what counts as acceptable. Two grading modes:

  exact  -- one right answer; score = P(gold)
  set    -- several defensible answers (L4); score = total P on the set
  labels -- multi-label noul node; graded per-item against gold booleans
"""
from jev.client import choice, noul, score

COMPONENTS = {
    "radio_group": "Radio group: all options visible, pick one",
    "select": "Dropdown select: collapsed list, pick one",
    "checkbox_group": "Checkbox group: all options visible, pick many",
    "multi_select": "Multi-select dropdown: collapsed list, pick many",
    "toggle": "Toggle switch: a single on/off state",
    "combobox": "Combobox: type to filter a long list, pick one",
    "segmented": "Segmented control: 2-4 short options in a row",
    "cards": "Comparison cards: side-by-side feature columns",
    "other": "None of these fit",
}

CASES = []


def C(node, level, name, state, questions, grade, gold, note=""):
    CASES.append(dict(node=node, level=level, name=name, state=state,
                      questions=questions, grade=grade, gold=gold, note=note))


# ---------------------------------------------------------------- COMPONENT
def comp(level, name, req, gold, extra=None, grade="exact"):
    st = {"request": req}
    if extra:
        st.update(extra)
    C("Component Decision", level, name, st,
      {"component": choice("Which UI component best fits this requirement?", COMPONENTS)},
      grade, gold)


comp("L1", "one-of-5-exclusive", "The user picks one of five mutually exclusive options.", ["radio_group"])
comp("L1", "notifications-on-off", "The user turns notifications on or off.", ["toggle"])
comp("L1", "one-of-200-countries", "The user picks one country from a list of 200.", ["combobox", "select"], grade="set")
comp("L2", "multi-20-interests", "The user selects multiple interests from a list of 20.",
     ["checkbox_group", "multi_select"], grade="set")
comp("L2", "plan-compare", "The user compares Free, Pro and Enterprise plans and picks one.", ["cards"])
comp("L2", "2-opts-mobile", "The user switches between two short views, List and Grid.",
     ["segmented", "radio_group"], {"surface": "mobile, width 375px"}, grade="set")
comp("L3", "5-opts-long-desc", "The user picks one of five options.",
     ["radio_group"], {"constraint": "each option has a two-sentence explanation that must stay visible",
                       "surface": "desktop"})
comp("L3", "long-list-a11y", "The user picks one of 200 options.",
     ["combobox"], {"constraint": "must be operable by keyboard only and announced by a screen reader"})
comp("L4", "12-options-ambiguous", "The user picks one of twelve options.",
     ["radio_group", "select", "combobox"], {"constraint": "no other constraints given"}, grade="set")

# -------------------------------------------------------------- TASK ASSIGN
NODES = {
    "research": "Investigate the existing codebase or architecture before acting",
    "component_decision": "Decide which UI component to use",
    "ui_generation": "Generate new UI structure or markup",
    "styling": "Decide or change the visual styling of the UI",
    "functional_action": "Perform a state-changing action in the app",
    "settings_update": "Change a stored setting value",
    "task_decomposition": "Break the request into multiple ordered subtasks",
}


def route(level, name, req, gold_true):
    C("Task Assignment", level, name, {"request": req},
      {k: noul(f"For this request, is this step required? Step: {v}") for k, v in NODES.items()},
      "labels", {k: (k in gold_true) for k in NODES})


route("L1", "button-color", "Change the button colour from blue to green.", {"styling"})
route("L1", "toggle-setting", "Turn off email notifications.", {"functional_action", "settings_update"})
route("L2", "settings-page", "Create a settings page where users change notification preferences.",
      {"research", "component_decision", "ui_generation", "functional_action", "settings_update",
       "task_decomposition"})
route("L3", "live-dashboard", "Build a dashboard showing the company's most important metrics, "
      "refreshing every minute.",
      {"research", "component_decision", "ui_generation", "styling", "functional_action",
       "task_decomposition"})
route("L4", "make-it-nicer", "Make the page feel more modern and easier to scan.",
      {"styling", "component_decision"})

# ---------------------------------------------------------- CONTEXT SELECT
POOL = {
    "react": ("Application is built with React", True),
    "tailwind": ("Application uses Tailwind CSS", True),
    "canada": ("The user lives in Canada", False),
    "localstorage": ("Theme preference is stored in localStorage", True),
    "twelve_controls": ("The existing settings page has 12 controls", True),
    "system_theme": ("System theme detection is supported by the app", True),
    "logo_blue": ("The company logo is blue", False),
    "joined_2y": ("The user joined two years ago", False),
    "semantic_tokens": ("The design system uses semantic colour tokens", True),
    "theme_exists": ("A theme implementation already exists in the codebase", True),
    "billing_stripe": ("Billing is handled by Stripe", False),
    "db_postgres": ("The database is Postgres", False),
    "ci_github": ("CI runs on GitHub Actions", False),
    "i18n_none": ("The app has no internationalisation", False),
    "a11y_target": ("The team targets WCAG 2.2 AA contrast", True),
    "team_size": ("The engineering team has four people", False),
    "deploy_vercel": ("The app deploys to Vercel", False),
    "font_inter": ("The UI font is Inter", False),
    "redux": ("Global state uses Redux", True),
    "mobile_60": ("60% of users are on mobile", False),
}


def ctx(level, name, n_items):
    items = dict(list(POOL.items())[:n_items])
    st = {"user_request": "Add a dark mode toggle to the Settings page.",
          "available_information": {k: v[0] for k, v in items.items()}}
    C("Context Selection", level, name, st,
      {k: noul(f"Is this fact necessary for an engineer implementing the request? "
               f"Fact: {v[0]}") for k, v in items.items()},
      "labels", {k: v[1] for k, v in items.items()})


ctx("L2", "pool-10", 10)
ctx("L3", "pool-15", 15)
ctx("L3", "pool-20", 20)

# -------------------------------------------------------------- FUNC ACTION
ACTIONS = {
    "disable_all": "Disable all notifications",
    "disable_push_only": "Disable push notifications only, leave email on",
    "disable_email_only": "Disable email notifications only, leave push on",
    "enable_all": "Enable all notifications",
    "snooze_temporary": "Temporarily suspend notifications, then restore them",
    "other": "None of these",
}


def act(level, name, utt, gold, grade="exact"):
    C("Functional Action", level, name, {"utterance": utt},
      {"action": choice("Which action does the user want performed?", ACTIONS)}, grade, gold)


act("L1", "turn-off", "Turn notifications off.", ["disable_all"])
act("L2", "push-not-email", "Disable push notifications but keep email notifications enabled.",
    ["disable_push_only"])
act("L3", "until-tomorrow", "Disable notifications until tomorrow.", ["snooze_temporary"])
act("L3", "push-off-confirm", "Disable push notifications, preserve email, and show me a confirmation.",
    ["disable_push_only"])
act("L4", "quiet-please", "It's too noisy, can you calm this down?",
    ["disable_all", "disable_push_only", "snooze_temporary"], grade="set")

# ------------------------------------------------------------ SETTINGS SCOPE
SETTINGS = {
    "push_enabled": "Push notifications enabled",
    "email_enabled": "Email notifications enabled",
    "sms_enabled": "SMS notifications enabled",
    "digest_weekly": "Weekly digest email enabled",
    "sound_enabled": "Notification sound enabled",
    "theme_dark": "Dark theme enabled",
}


def setting(level, name, utt, gold_changed):
    C("Settings Update", level, name, {"utterance": utt, "current_settings": SETTINGS},
      {k: noul(f"Does the user's instruction require changing this setting? Setting: {v}")
       for k, v in SETTINGS.items()},
      "labels", {k: (k in gold_changed) for k in SETTINGS})


setting("L1", "mute-sound", "Turn off the notification sound.", {"sound_enabled"})
setting("L2", "push-only", "Stop push notifications, but I still want emails.", {"push_enabled"})
setting("L3", "all-but-sms", "Turn off every kind of notification except SMS.",
        {"push_enabled", "email_enabled", "digest_weekly", "sound_enabled"})
setting("L4", "too-many-emails", "I'm getting way too many emails from you.",
        {"email_enabled", "digest_weekly"})

# --------------------------------------------------- RESEARCH STRATEGY (filter)
RESEARCH = {
    "theme_arch": ("Existing theme architecture", True),
    "color_tokens": ("Current colour token definitions", True),
    "dark_support": ("Whether any dark-mode support already exists", True),
    "persistence": ("How theme preference is persisted", True),
    "system_pref": ("Whether system colour-scheme preference is read", True),
    "settings_arch": ("How the settings page is structured", True),
    "ds_constraints": ("Design-system constraints on colour", True),
    "competitors": ("How competitor products implement dark mode", False),
    "analytics": ("Analytics on feature usage", False),
    "payment": ("Which payment provider is used", False),
    "db_schema": ("The database schema", False),
    "branding": ("Brand guideline documents", False),
}

C("Research Strategy", "L2", "darkmode-filter",
  {"user_request": "I want to add dark mode to my application.",
   "candidate_investigations": {k: v[0] for k, v in RESEARCH.items()}},
  {k: noul(f"Must this be investigated before implementing the request? Item: {v[0]}")
   for k, v in RESEARCH.items()},
  "labels", {k: v[1] for k, v in RESEARCH.items()})

C("Research Strategy", "L3", "darkmode-priority",
  {"user_request": "I want to add dark mode to my application.",
   "candidate_investigations": {k: v[0] for k, v in RESEARCH.items()}},
  {k: score(f"How early must this be investigated? Item: {v[0]}",
            ["Not needed at all", "Useful later", "Needed before implementation starts"])
   for k, v in RESEARCH.items()},
  "labels_score", {k: v[1] for k, v in RESEARCH.items()})

# ------------------------------------------------- RESEARCH STOPPING CONDITION
C("Research Stop", "L2", "enough-info",
  {"situation": "Three possible implementation approaches have been identified and their main "
                "tradeoffs are documented and distinguishable."},
  {"stop": noul("Is the available information sufficient to choose between the approaches "
                "without further investigation?")},
  "bool", True)

C("Research Stop", "L3", "missing-critical",
  {"situation": "Two implementation approaches have been identified, but it is not known which "
                "browsers must be supported, and the approaches differ only in browser support."},
  {"stop": noul("Is the available information sufficient to choose between the approaches "
                "without further investigation?")},
  "bool", False)

# ------------------------------------------------ TASK DECOMPOSITION (filter)
STEPS = {
    "read_settings": ("Read the existing settings page implementation", True),
    "name_field": ("Add a name field with validation", True),
    "avatar_upload": ("Add profile picture upload", True),
    "password_change": ("Add password change with current-password confirmation", True),
    "notif_prefs": ("Add notification preference controls", True),
    "validation": ("Add client-side validation and error states", True),
    "persist": ("Wire the form to a persistence endpoint", True),
    "verify": ("Verify the saved values survive a reload", True),
    "rewrite_router": ("Rewrite the application router", False),
    "migrate_db": ("Migrate the database to a new provider", False),
    "redesign_ds": ("Redesign the whole design system", False),
    "add_i18n": ("Add internationalisation to the whole app", False),
}

C("Task Decomposition", "L3", "profile-page-filter",
  {"user_request": "Build a profile settings page where users can change their name, profile "
                   "picture, password, and notification preferences.",
   "candidate_steps": {k: v[0] for k, v in STEPS.items()}},
  {k: noul(f"Is this step required to fulfil the request? Step: {v[0]}")
   for k, v in STEPS.items()},
  "labels", {k: v[1] for k, v in STEPS.items()})

# ------------------------------------------------------------------ STYLING
STYLE_OPTS = {
    "increase_size": "Increase the element's size",
    "accent_color": "Apply the design system's accent colour",
    "increase_weight": "Increase font weight",
    "add_shadow": "Add a drop shadow",
    "increase_whitespace": "Increase surrounding whitespace so it stands alone",
    "demote_siblings": "Reduce the visual weight of competing elements",
    "other": "None of these",
}
C("Styling", "L1", "blue-to-green", {"instruction": "Change this button from blue to green."},
  {"safe": noul("Is this instruction specific enough to apply without further design judgement?")},
  "bool", True)
C("Styling", "L3", "cta-prominent",
  {"instruction": "Make the primary CTA more prominent without increasing its visual weight too "
                  "much or disrupting the existing hierarchy.",
   "design_system": "semantic tokens, fixed type scale, accent colour reserved for primary actions"},
  {"approach": choice("Which single approach best satisfies the instruction?", STYLE_OPTS)},
  "set", ["increase_whitespace", "demote_siblings"])
C("Styling", "L4", "modern-scannable",
  {"instruction": "Make the page feel more modern and easier to scan."},
  {"safe": noul("Is this instruction specific enough to apply without further design judgement?")},
  "bool", False)
