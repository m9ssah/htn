# Jev test harness

Measures what Jev (TypeSafe System One) can and cannot do, so the agent architecture can
be designed against real numbers. Findings: [`../docs/jev-findings-v1.md`](../docs/jev-findings-v1.md).

```
jev/client.py   stdlib-only API client: latency timing, usage/spend ledger, hard caps
probes/cases.py 34 gold-labelled cases, 9 node roles, difficulty L1-L4
probes/p01..p04 limits / scaling / node suitability / escalation threshold
results/        raw JSON output from each probe
```

## Setup

Key is read from `TYPESAFE_API_KEY`, falling back to `~/.config/typesafe/env` (mode 600,
outside this repo). No dependencies — Python 3.11+ stdlib only.

```bash
python3 backend/probes/p01_hard_limits.py
python3 backend/probes/p02_scaling.py
python3 backend/probes/p03_node_suitability.py
python3 backend/probes/p04_escalation.py
```

Every probe is bounded by `max_requests` and `max_usd` in the `Jev(...)` constructor and
stops before submitting a request that would exceed them. The full suite costs ~$0.02.

## Using the client

```python
from jev.client import Jev, choice, noul, score

jev = Jev(max_usd=1.00)
r = jev.evaluate(
    {"request": "user picks one of five shipping speeds"},
    {"component": choice("Which UI component fits?",
                         {"radio_group": "All options visible, pick one",
                          "select": "Collapsed dropdown",
                          "other": "None of these"}),
     "needs_research": noul("Must the existing codebase be inspected first?")},
)
a = r.answers["component"]
if a.confidence >= 0.60:      # measured gate: 100% accuracy above this
    act(a.value)
else:
    escalate()                 # ~26% of decisions
```

Questions in one request run in parallel and cost no extra latency — batch them.
