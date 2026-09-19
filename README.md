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

Metro's bones, a modern skin. Metro supplies the structure — a tile mosaic, type
doing the hierarchy, colour as a field rather than an outline — and the surface
treatment is current: one small radius, depth as fill rather than stroke.

**The ground is always dark.** All four palettes are dark by construction, and
`applyPolish` enforces the same rule against agent 4's raw tokens: a patch that
would paint a light background has its colours reverted to the enum base, while
its shape, type and density still land. The shell cannot restyle itself, so a
light surface inside it reads as a white card dropped on a black device rather
than as a themed surface.

**Colour.** The home mosaic carries four saturated accents on a plum ground and
a tile is distinguished by which one it wears. The chrome — rail, fader, face,
focus rings — uses a single accent and never joins in; a second colour in the
chrome is what makes a multi-accent palette read as inconsistent.

**Gradients are three stops, never two,** and appear in exactly two places: the
primary button and the progress fill. Two colours read as a crossfade between
two things; three read as one material catching the light. Never on a tile,
never on the face — a large field with a gradient across it is the thing this
design is not.

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
