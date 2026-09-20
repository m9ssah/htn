import type {
  ContrastCheck,
  ContrastPair,
  ContrastReport,
  Surface,
  TokenSet,
} from '@jit/schema';

/** WCAG AA for body text. No large-text 3:1 exemption is claimed anywhere. */
export const AA_NORMAL = 4.5;

type Rgb = { r: number; g: number; b: number };

/**
 * Parses the colour notations agent 4 actually emits: hex 3/4/6/8 and
 * rgb()/rgba() in both comma and space syntax.
 *
 * Returns null rather than a guess. A colour we cannot read is a colour we
 * cannot certify, and certifying it anyway is the silent fallback we are not
 * allowed to ship.
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const d = hex[1]!;
    if (d.length === 3 || d.length === 4) {
      return {
        r: parseInt(d[0]! + d[0]!, 16),
        g: parseInt(d[1]! + d[1]!, 16),
        b: parseInt(d[2]! + d[2]!, 16),
      };
    }
    if (d.length === 6 || d.length === 8) {
      return {
        r: parseInt(d.slice(0, 2), 16),
        g: parseInt(d.slice(2, 4), 16),
        b: parseInt(d.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((p) => {
      if (p.endsWith('%')) {
        const pct = Number.parseFloat(p);
        return Number.isFinite(pct) ? Math.round((pct / 100) * 255) : Number.NaN;
      }
      return Number.parseFloat(p);
    });
    if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null;
    return { r: channels[0]!, g: channels[1]!, b: channels[2]! };
  }

  return null;
}

/** WCAG 2.1 relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIR_VARS: Record<ContrastPair, { fg: keyof TokenSet; bg: keyof TokenSet }> = {
  'fg-on-bg': { fg: '--jit-fg', bg: '--jit-bg' },
  'muted-on-bg': { fg: '--jit-muted', bg: '--jit-bg' },
  'fg-on-surface': { fg: '--jit-fg', bg: '--jit-surface' },
  'muted-on-surface': { fg: '--jit-muted', bg: '--jit-surface' },
  'on-accent-on-accent': { fg: '--jit-on-accent', bg: '--jit-accent' },
  // Badge and Alert (recovery.diagnosis) both render fg-colored text on this
  // background. See ContrastPair's doc comment for why there is no
  // accent-on-accent-soft: Badge used to use accent, and no accentSoft value
  // could make that pass AA for every accent hue.
  'fg-on-accent-soft': { fg: '--jit-fg', bg: '--jit-accent-soft' },
};

const PAIRS_BY_SURFACE: Record<Surface, ContrastPair[]> = {
  bg: ['fg-on-bg', 'muted-on-bg'],
  surface: ['fg-on-surface', 'muted-on-surface'],
  'accent-soft': ['fg-on-accent-soft'],
};

export type CheckContrastOptions = {
  /**
   * The grounds the active template actually draws text on. `reader` has no Card
   * and paints straight onto bg; every other template paints inside one. Omit to
   * require the four bg/surface pairs (plus on-accent-on-accent, always
   * required). Pass `'accent-soft'` too for a template whose tree contains a
   * `Badge` or an `Alert`.
   */
  surfaces?: readonly Surface[];
};

/**
 * WCAG AA check over the six pairs the renderer can actually produce.
 *
 * Nothing is ever skipped. An unparseable colour yields a FAILING check with a
 * null ratio and a reason, because "we could not tell" and "it is fine" must not
 * look the same to the caller.
 *
 * `on-accent-on-accent` is always required — every template renders at least
 * one button via `getActions()`. `fg-on-accent-soft` is opt-in via
 * `surfaces: [...,'accent-soft']`, the same as `surface`, because only
 * templates with a `Badge` or an `Alert` in their tree paint on that ground —
 * see the renderer's template tests for the check that a template containing
 * either always declares it.
 *
 * Pure, so the orchestrator can run this before emitting a polish patch — which
 * is the real fix when agent 4 goes unreadable. Rejecting at the renderer is the
 * last line of defence, not the intended one.
 */
export function checkContrast(
  tokens: Partial<TokenSet>,
  options: CheckContrastOptions = {},
): ContrastReport {
  const required = new Set<ContrastPair>(['on-accent-on-accent']);
  const surfaces = options.surfaces ?? (['bg', 'surface'] as const);
  for (const surface of surfaces) {
    for (const pair of PAIRS_BY_SURFACE[surface]) required.add(pair);
  }

  const checks: ContrastCheck[] = [];
  for (const pair of Object.keys(PAIR_VARS) as ContrastPair[]) {
    if (!required.has(pair)) continue;
    const { fg, bg } = PAIR_VARS[pair];
    const fgRaw = tokens[fg];
    const bgRaw = tokens[bg];

    if (fgRaw === undefined || bgRaw === undefined) {
      const missing = [fgRaw === undefined ? fg : null, bgRaw === undefined ? bg : null]
        .filter(Boolean)
        .join(', ');
      checks.push({
        pair,
        ratio: null,
        required: AA_NORMAL,
        pass: false,
        reason: `missing token: ${missing}`,
      });
      continue;
    }

    const fgColor = parseColor(fgRaw);
    const bgColor = parseColor(bgRaw);
    if (!fgColor || !bgColor) {
      const bad = [!fgColor ? `${fg}: ${fgRaw}` : null, !bgColor ? `${bg}: ${bgRaw}` : null]
        .filter(Boolean)
        .join(', ');
      checks.push({
        pair,
        ratio: null,
        required: AA_NORMAL,
        pass: false,
        reason: `unparseable colour: ${bad}`,
      });
      continue;
    }

    const ratio = Math.round(contrastRatio(fgColor, bgColor) * 100) / 100;
    const pass = ratio >= AA_NORMAL;
    checks.push({
      pair,
      ratio,
      required: AA_NORMAL,
      pass,
      ...(pass ? {} : { reason: `${ratio}:1 is below AA ${AA_NORMAL}:1` }),
    });
  }

  return { pass: checks.every((c) => c.pass), checks };
}
