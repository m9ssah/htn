# JIT UI

Transforms interfaces that already exist to match what a user says they need.
See `CLAUDE.md` for scope, constraints, and the decision log.

## Setup

Node 24 via nvm. It is **not** on the default non-interactive PATH:

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
npm install
```

## Packages

| Package | What it is |
|---|---|
| `packages/schema` | The patch contract. Types only, zero runtime deps. |
| `packages/tokens` | Enum tables, `resolve`, `applyPolish`, `checkContrast`. |
| `packages/renderer` | Framework-free JSON renderer + the 8 templates. |

`packages/*` must not import from `apps/*`. The renderer must not know that Jev,
Chrome or a Raspberry Pi exist.

## Commands

```bash
npm run build      # tsc -b across all three packages
npm test           # vitest, including type-level contract tests
npm run harness    # dev harness at http://localhost:5174
```

## The harness

Fires each of the four patches independently, so the staging is inspectable by
hand. Also does shuffled order, production-timed staging, and a deliberately
unreadable polish patch to exercise the contrast gate.

Deep links: `?s=<scenario index>&fire=all|staged|unreadable|skeleton,content,...`

### Layout stability check

`http://localhost:5174/reflow-check.html` measures real geometry. The unit tests
run under happy-dom, which performs no layout, so this is the only place the
"shimmer at final dimensions" guarantee can actually be verified.

```bash
npm run harness &
google-chrome --headless --virtual-time-budget=6000 \
  --dump-dom http://localhost:5174/reflow-check.html | grep REFLOW-CHECK
```
