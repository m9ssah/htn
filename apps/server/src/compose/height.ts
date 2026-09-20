import type { LeafComponentV2, SurfaceSpec } from '@jit/schema';

/**
 * How tall a projected surface will be, before anything has been rendered.
 *
 * The panel is 800x480 and never scrolls, but a projected surface is sized by
 * its content: `focus_step` with three ingredient rows measured 431px against
 * a 364px stage, which put its primary button below the fold. The composer
 * already budgets WIDTH (`maxWidth`) and folds the overflow into a "+N more"
 * row; this is the same idea for height, so the fold happens while the
 * surface is being built rather than being discovered by a judge.
 *
 * **These are estimates, and they are calibrated rather than guessed.** Every
 * number below was measured in Chrome at the bootstrap theme
 * (`fixtures/surface-metrics.json` records the run), because happy-dom
 * performs no layout and a unit test therefore cannot catch drift here. The
 * estimate only has to be good enough to decide how many rows fit, so it is
 * deliberately conservative: `SAFETY` shrinks the usable budget rather than
 * trusting the model to the pixel.
 *
 * It scales with `density`, because that is what `--jit-gap`/`--jit-pad` do —
 * an estimator pinned to one density would over-fill a spacious surface.
 */

/** Measured at density 1. A component's own box, excluding the gap below it. */
const NOMINAL: Record<LeafComponentV2, number> = {
  Heading: 29, // per line; see `headingHeight`
  Text: 21, // per line
  Label: 16,
  Badge: 22,
  Metric: 64,
  Media: 104,
  ListItem: 37,
  Rule: 21,
  Button: 41,
  TextField: 58,
  Toggle: 42,
  Alert: 78,
  Slider: 66,
  Bars: 62,
  Progress: 10,
};

/** Measured: `--jit-gap` 14px at density 1. */
const GAP = 14;
/** Exported so a template can cost N stacked rows, gaps included. */
export const GAP_PX = GAP;
/**
 * The root's padding plus the card's, which nest — 20px each, top and bottom.
 * Calibrated, not derived: an earlier value of 44 put `focus_step` at 396px
 * when Chrome measured it at 431, and the 35px difference is exactly one row
 * the budget would have wrongly allowed.
 */
const CHROME = 80;

/**
 * Trims the usable budget rather than trusting the estimate to the pixel.
 * Over-estimating costs one folded row; under-estimating clips the primary
 * action, so the asymmetry is deliberate.
 */
const SAFETY = 0.94;

/** A component's height, including the multi-line reservations templates set. */
export function leafHeight(type: LeafComponentV2, options: { lines?: number; hasDetail?: boolean } = {}): number {
  const lines = options.lines ?? 1;
  if (type === 'Heading' || type === 'Text') return NOMINAL[type] * lines;
  // A ListItem's second line is a real reservation (`data-has-detail`), not a
  // content property — same reasoning as `lines`.
  if (type === 'ListItem' && options.hasDetail) return NOMINAL.ListItem + 18;
  return NOMINAL[type];
}

/**
 * What a finished spec will occupy, by the same metrics the budget spends.
 *
 * Walks the leaves rather than the tree: the containers are a `Card` holding
 * a `Stack`, so their cost is the one `CHROME` constant, and a `ButtonGroup`
 * lays its children out in a row — counted once, at the tallest.
 */
export function estimateSpecHeight(spec: SurfaceSpec): number {
  const heightOf = (key: string): number => {
    const element = spec.elements[key];
    if (!element) return 0;
    if (!(element.type in NOMINAL)) return columnHeight(key);
    const reserve = element.props['reserveLines'];
    const lines = typeof reserve === 'number' ? reserve : 1;
    return leafHeight(element.type as LeafComponentV2, {
      lines,
      ...(element.props['hasDetail'] === true ? { hasDetail: true } : {}),
    });
  };

  /**
   * A container's height.
   *
   * `Row` and `Grid` put their children SIDE BY SIDE, so they are as tall as
   * their tallest column rather than the sum — summing them is what made a
   * two-column surface look like it overflowed when it comfortably fits, and
   * the whole point of the columns is that they halve the height.
   */
  const columnHeight = (key: string): number => {
    const element = spec.elements[key];
    const children = element?.children ?? [];
    if (children.length === 0) return 0;
    const heights = children.map(heightOf);
    if (element?.type === 'Row' || element?.type === 'Grid' || element?.type === 'ButtonGroup') {
      return Math.max(...heights);
    }
    return heights.reduce((sum, h) => sum + h, 0) + GAP * Math.max(0, heights.length - 1);
  };

  return columnHeight(spec.root) + CHROME;
}

export type HeightBudget = {
  /** What is left for further rows, in px. */
  remaining(): number;
  /**
   * Would one more component of this height fit, AND still leave room for
   * `tail` — the mandatory elements a template adds after its rows?
   *
   * Without the tail, rows eat the budget and the primary button is what
   * falls off, which is the worst thing on the surface to lose.
   */
  fits(height: number, tail?: number): boolean;
  /** Spend `height` plus the gap that precedes it. */
  spend(height: number): void;
  /** True when the mandatory parts alone already overflow. */
  readonly overflowed: boolean;
};

/**
 * `maxHeight` is the STAGE height the device gives a surface, not the panel —
 * the shell's own rail and input are not this layer's business, so whoever
 * owns the device passes what is actually available.
 */
export function createBudget(maxHeight: number, density = 1): HeightBudget {
  const gap = GAP * density;
  let left = maxHeight * SAFETY - CHROME * density;
  const initial = left;
  let first = true;
  return {
    remaining: () => left,
    fits: (height, tail = 0) => left - (first ? height : height + gap) - (tail > 0 ? tail + gap : 0) >= 0,
    spend: (height) => {
      left -= first ? height : height + gap;
      first = false;
    },
    get overflowed(): boolean {
      return left < 0 && initial > 0;
    },
  };
}
