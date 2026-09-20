"""Cases v2 -- targeted at the ACTUAL product architecture (the two diagrams).

Differences from v1, both material:

  * Nodes are the diagram's boxes, not the spec's generic list. `agent 1
    info grabbing` is split into the decidable half (what to research) and the
    impossible half (retrieval), because Jev has no tools.
  * Every noul carries the documented `criteria: {true,false}`. Probe 6 showed
    bare instructions cost Context Selection 11 points of recall -- v1 measured
    every noul node below its ceiling.
"""
from jev.client import choice, noul, score

CASES = []


def C(node, level, name, state, questions, grade, gold):
    CASES.append(dict(node=node, level=level, name=name, state=state,
                      questions=questions, grade=grade, gold=gold))


# ===================================================== agent A: task assignment
# Diagram: user request -> agent A -> {agent 1 info, agent 2 component, agent 3 styling}
AGENTS = {
    "agent1_info": ("Agent 1 - gather information about the existing app before acting",
                    "The request cannot be fulfilled without first inspecting existing code, data, or configuration",
                    "Everything needed is already stated in the request"),
    "agent2_component": ("Agent 2 - decide which UI component to use",
                         "The request requires choosing or adding a UI control that does not exist yet",
                         "No new UI control is needed; existing ones suffice"),
    "agent3_styling": ("Agent 3 - change the styling of a component",
                       "The request asks for a visual change to something that already exists",
                       "The request does not ask for a visual change"),
    "image_gen": ("Image generation",
                  "The request requires producing a new image or graphic asset",
                  "No new imagery is required"),
    "functional_action": ("Perform a functional action - change app state",
                          "The request requires changing stored state or performing an operation",
                          "The request is read-only or purely visual"),
    "update_setting": ("Update a setting value",
                       "The request changes a persisted user preference",
                       "No persisted preference changes"),
    "todo_decomp": ("Produce a to-do list - decompose into ordered subtasks",
                    "The request needs three or more dependent steps to complete",
                    "The request is one or two independent steps"),
}


def route(level, name, req, gold_true):
    C("A: Task Assignment", level, name, {"user_request": req},
      {k: noul(f"Is this agent required for the request? Agent: {d}", true=t, false=f)
       for k, (d, t, f) in AGENTS.items()},
      "labels", {k: (k in gold_true) for k in AGENTS})


route("L1", "button-color", "Change the save button from blue to green.", {"agent3_styling"})
route("L1", "mute-sound", "Turn off the notification sound.",
      {"functional_action", "update_setting"})
route("L2", "add-toggle", "Add a dark mode toggle to the settings page.",
      {"agent1_info", "agent2_component", "functional_action", "update_setting"})
route("L2", "hero-image", "Add a hero banner image to the landing page.",
      {"agent2_component", "image_gen", "agent3_styling"})
route("L3", "live-dashboard", "Build a dashboard of our most important metrics that refreshes every minute.",
      {"agent1_info", "agent2_component", "agent3_styling", "functional_action", "todo_decomp"})
route("L3", "profile-page", "Build a profile settings page for name, avatar, password and notification preferences.",
      {"agent1_info", "agent2_component", "functional_action", "update_setting", "todo_decomp"})
route("L4", "make-it-nicer", "Make the page feel more modern and easier to scan.",
      {"agent3_styling"})

# ============================================ agent 1: info grabbing -- SPLIT
# The decidable half. The retrieval half is structurally impossible for Jev and
# has no cases by design.
RESEARCH = {
    "theme_arch": ("Existing theme architecture", True),
    "color_tokens": ("Current colour token definitions", True),
    "dark_support": ("Whether dark-mode support already exists", True),
    "persistence": ("How theme preference is persisted", True),
    "settings_arch": ("How the settings page is structured", True),
    "ds_constraints": ("Design-system constraints on colour", True),
    "competitors": ("How competitors implement dark mode", False),
    "analytics": ("Analytics on feature usage", False),
    "payment": ("Which payment provider is used", False),
    "db_schema": ("The database schema", False),
    "branding": ("Brand guideline documents", False),
    "team_size": ("How many engineers are on the team", False),
}
C("1: Research Strategy", "L2", "what-to-research",
  {"user_request": "Add dark mode to the application.",
   "candidates": {k: v[0] for k, v in RESEARCH.items()}},
  {k: noul(f"Must this be investigated before implementation can start? Item: {v[0]}",
           true="Not knowing this could make the implementation wrong or require rework",
           false="Useful background at most; implementation can proceed correctly without it")
   for k, v in RESEARCH.items()},
  "labels", {k: v[1] for k, v in RESEARCH.items()})

# Stopping condition -- decomposed per probe 4's finding that meta-questions drift
C("1: Research Stop", "L2", "sufficient-yes",
  {"approaches_found": 3, "tradeoffs": "documented and distinguishable for all three",
   "open_questions": "none recorded"},
  {"has_open": noul("Does `open_questions` record any unresolved question?",
                    true="One or more open questions are listed",
                    false="No open questions are listed"),
   "tradeoffs_clear": noul("Does `tradeoffs` state the tradeoffs are distinguishable?",
                           true="The field says they are documented and distinguishable",
                           false="The field is absent, empty, or says they are unclear")},
  "labels", {"has_open": False, "tradeoffs_clear": True})

C("1: Research Stop", "L3", "sufficient-no",
  {"approaches_found": 2, "tradeoffs": "the two differ only in browser support",
   "open_questions": "which browsers must be supported is unknown"},
  {"has_open": noul("Does `open_questions` record any unresolved question?",
                    true="One or more open questions are listed",
                    false="No open questions are listed"),
   "blocks_choice": noul("Would the unresolved question change which approach is chosen?",
                         true="The approaches differ on exactly the unknown dimension",
                         false="The unknown is irrelevant to the choice")},
  "labels", {"has_open": True, "blocks_choice": True})

# ==================================== agent 2: component decision (v1: 9/9 pass)
COMPONENTS = {
    "radio_group": "Radio group: all options visible, pick one",
    "select": "Dropdown select: collapsed list, pick one",
    "checkbox_group": "Checkbox group: all visible, pick many",
    "multi_select": "Multi-select dropdown: collapsed, pick many",
    "toggle": "Toggle switch: a single on/off state",
    "combobox": "Combobox: type to filter a long list, pick one",
    "segmented": "Segmented control: 2-4 short options in a row",
    "cards": "Comparison cards: side-by-side feature columns",
    "slider": "Slider: pick a value on a continuous range",
    "date_picker": "Date picker: choose a calendar date",
    "other": "None of these fit",
}


def comp(level, name, req, gold, extra=None, grade="exact"):
    st = {"request": req}
    if extra:
        st.update(extra)
    C("2: Component Decision", level, name, st,
      {"component": choice("Which UI component best fits this requirement?", COMPONENTS)},
      grade, gold)


comp("L2", "volume-0-100", "The user sets volume anywhere from 0 to 100.", ["slider"])
comp("L2", "pick-birthday", "The user enters their date of birth.", ["date_picker"])
comp("L3", "5-opts-2-visible", "The user picks one of five options.",
     ["radio_group"], {"constraint": "the surface has room for two lines of text total"},
     grade="set")
comp("L3", "multi-200-a11y", "The user selects several tags from 200 available.",
     ["multi_select", "combobox"], {"constraint": "keyboard-only operation required"}, grade="set")
comp("L4", "rate-satisfaction", "The user rates how satisfied they are.",
     ["radio_group", "segmented", "slider"], grade="set")

# ====================================== LLM Gain Context (highlighted in diagram)
POOL = {
    "react": ("Application is built with React", True),
    "tailwind": ("Application uses Tailwind CSS", True),
    "localstorage": ("Theme preference is stored in localStorage", True),
    "settings_12": ("The existing settings page has 12 controls", True),
    "system_theme": ("System theme detection is supported", True),
    "semantic_tokens": ("The design system uses semantic colour tokens", True),
    "theme_exists": ("A theme implementation already exists", True),
    "a11y_target": ("The team targets WCAG 2.2 AA contrast", True),
    "redux": ("Global state uses Redux", True),
    "canada": ("The user lives in Canada", False),
    "logo_blue": ("The company logo is blue", False),
    "joined_2y": ("The user joined two years ago", False),
    "billing_stripe": ("Billing is handled by Stripe", False),
    "db_postgres": ("The database is Postgres", False),
    "ci_github": ("CI runs on GitHub Actions", False),
    "team_size": ("The engineering team has four people", False),
    "deploy_vercel": ("The app deploys to Vercel", False),
    "mobile_60": ("60% of users are on mobile", False),
    "founded_2019": ("The company was founded in 2019", False),
    "uses_jira": ("The team tracks work in Jira", False),
}


def ctxcase(level, name, n, req="Add a dark mode toggle to the Settings page."):
    items = dict(list(POOL.items())[:n])
    C("LLM Gain Context", level, name,
      {"user_request": req, "available_information": {k: v[0] for k, v in items.items()}},
      {k: noul(f"Should this be passed to the execution agent? Fact: {v[0]}",
               true="The fact constrains how the feature must be built, or describes code it touches",
               false="The fact is about the user, the business, or unrelated infrastructure")
       for k, v in items.items()},
      "labels", {k: v[1] for k, v in items.items()})


ctxcase("L2", "ctx-10", 10)
ctxcase("L3", "ctx-20", 20)

# ============================================= Execution fan-out: setting update
SETTINGS = {
    "push_enabled": "Push notifications enabled",
    "email_enabled": "Email notifications enabled",
    "sms_enabled": "SMS notifications enabled",
    "digest_weekly": "Weekly digest email enabled",
    "sound_enabled": "Notification sound enabled",
    "theme_dark": "Dark theme enabled",
    "autoplay": "Autoplay videos enabled",
}


def setting(level, name, utt, gold_changed):
    C("Update Setting", level, name, {"utterance": utt, "current_settings": SETTINGS},
      {k: noul(f"Must this setting change to satisfy the instruction? Setting: {v}",
               true="The instruction explicitly or necessarily requires this exact setting to change",
               false="The instruction leaves this setting as it is")
       for k, v in SETTINGS.items()},
      "labels", {k: (k in gold_changed) for k in SETTINGS})


setting("L2", "all-but-sms", "Turn off every kind of notification except SMS.",
        {"push_enabled", "email_enabled", "digest_weekly", "sound_enabled"})
setting("L3", "quiet-not-dark", "Make it quieter but don't change how it looks.",
        {"push_enabled", "sound_enabled", "digest_weekly", "email_enabled"})
setting("L4", "too-many-emails", "I'm getting way too many emails from you.",
        {"email_enabled", "digest_weekly"})

# ================================================= to-do from llm: decomposition
STEPS = {
    "read_settings": ("Read the existing settings page implementation", True),
    "name_field": ("Add a name field with validation", True),
    "avatar_upload": ("Add profile picture upload", True),
    "password_change": ("Add password change with current-password confirmation", True),
    "notif_prefs": ("Add notification preference controls", True),
    "validation": ("Add client-side validation and error states", True),
    "persist": ("Wire the form to a persistence endpoint", True),
    "verify": ("Verify saved values survive a reload", True),
    "rewrite_router": ("Rewrite the application router", False),
    "migrate_db": ("Migrate the database to a new provider", False),
    "redesign_ds": ("Redesign the whole design system", False),
    "add_i18n": ("Add internationalisation to the whole app", False),
    "rename_repo": ("Rename the git repository", False),
}
C("to-do: Decomposition", "L3", "profile-page",
  {"user_request": "Build a profile settings page where users can change their name, "
                   "profile picture, password, and notification preferences.",
   "candidate_steps": {k: v[0] for k, v in STEPS.items()}},
  {k: noul(f"Is this step required to fulfil the request? Step: {v[0]}",
           true="The request cannot be considered complete without this step",
           false="The step is unrelated, or is a larger change the request did not ask for")
   for k, v in STEPS.items()},
  "labels", {k: v[1] for k, v in STEPS.items()})
