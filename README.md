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
| `packages/schema` | Runtime-validated surface and content-generation contracts. |
| `packages/tokens` | Enum tables, `resolve`, `applyPolish`, `checkContrast`. |
| `packages/renderer` | json-render catalog, React registry, renderer, and evaluated examples. |

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

**There are no gradients.** Each palette carries exactly one accent, so the rule
has no second colour to be broken with. The only `linear-gradient` left in the
codebase is the loading shimmer's travelling highlight, which is a mask over a
solid fill rather than a colour blend.

**Surfaces are glass, not frames.** A card is a translucent pane with a bright
hairline on its top edge and a dark one on its bottom, rather than an opaque
lighter box with a stroke. The fill is mixed from `--jit-surface` over
`--jit-bg` on purpose: both of those are certified by the contrast gate, so
every pixel of the pane lies between two already-checked grounds and the gate
stays honest. `backdrop-filter` is quarantined in its own `@supports` block —
deleting that block is the entire fallback if a panel cannot hold frames.

**Type.** Body is **Manrope** (bundled, variable 200-800), standing in for Segoe
UI, which is proprietary and cannot ship. Display is a bitmap face: the design
calls for **OffBit**, which is commercial and cannot be committed here, so
`OffBit` leads every display stack and **Pixelify Sans** (bundled, OFL) stands
in behind it. Adding licensed OffBit files to `packages/tokens/assets` with an
`@font-face` is the whole of the switch — no other file changes.

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

The device app runs at `http://localhost:3000/`. Its visual testbench lives at
`http://localhost:3000/testbench`; it presents every demo surface inside the
Pi's native 800×480 viewport, with a design-system primitives gallery first.

## Generated surfaces

The four updates are: Jev chooses a constrained json-render flat spec; the
content model fills only the selected state fields; the theme selector chooses
enum axes; and polish supplies contrast-gated tokens. The device shell, face,
and rail stay ordinary application code. See
[`docs/stage-2-contract.md`](docs/stage-2-contract.md) for the exact synthetic
data handoff, and [`docs/mock-pages.md`](docs/mock-pages.md) for adding a new
schema-driven mock page.

## The harness

The device testbench and renderer harness both render the json-render examples
and primitive gallery. The reflow check measures Stage 2 state updates across
all four font pairings.

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
