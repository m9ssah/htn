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

### The look

Metro's bones, a modern skin. Metro supplies the structure — tile grid, type
doing the hierarchy, colour as a field rather than an outline — and the surface
treatment is current: one small radius, accent fields lit by a gradient rather
than printed flat, depth as fill rather than stroke.

Type is **Manrope** (bundled, variable 200-800), standing in for Segoe UI, which
is proprietary and cannot ship. Display type is set at 200.

The device's face is two kaomoji crossfading — see `apps/device/src/emoticon.ts`.
Its glyphs come from a 2.3KB `JIT Kaomoji` subset, because Manrope contains none
of them and the device would otherwise paint tofu.

**The motion budget is absolute: only `opacity` and `transform` are animated.**
Both are composited, so the panel never relayouts or repaints mid-transition no
matter what is being generated behind it. Nothing animates `filter`,
`backdrop-filter`, `box-shadow`, a dimension or a colour — every one of those is
per-frame CPU work this device does not have.

`packages/*` must not import from `apps/*`. The renderer must not know that Jev,
Chrome or a Raspberry Pi exist.

## Commands

```bash
npm run build      # tsc -b across all three packages
npm test           # vitest, including type-level contract tests
npm run harness    # dev harness at http://localhost:3001
```

## The harness

Fires each of the four patches independently, so the staging is inspectable by
hand. Also does shuffled order, production-timed staging, and a deliberately
unreadable polish patch to exercise the contrast gate.

Deep links: `?s=<scenario index>&fire=all|staged|unreadable|skeleton,content,...`

### Layout stability check

`http://localhost:3001/reflow-check.html` measures real geometry. The unit tests
run under happy-dom, which performs no layout, so this is the only place the
"shimmer at final dimensions" guarantee can actually be verified.

```bash
npm run harness &
google-chrome --headless --virtual-time-budget=6000 \
  --dump-dom http://localhost:3001/reflow-check.html | grep REFLOW-CHECK
```
