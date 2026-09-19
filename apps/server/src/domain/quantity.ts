/**
 * Quantities, and how to show them to a human.
 *
 * Kept separate from the recipe model because this is where floating point
 * meets a kitchen: 3.3333 cups of flour has to read as "3⅓ cups" or the whole
 * surface looks like a spreadsheet, and "2.0000000004 tsp" on stage would be
 * the single most damaging pixel in the demo.
 */

export type Unit = 'cup' | 'tsp' | 'tbsp' | 'g' | 'ml' | 'each';

export type Quantity = { amount: number; unit: Unit };

/** Fraction glyphs, by denominator then numerator. */
const GLYPHS: Record<number, Record<number, string>> = {
  2: { 1: '½' },
  3: { 1: '⅓', 2: '⅔' },
  4: { 1: '¼', 3: '¾' },
  8: { 1: '⅛', 3: '⅜', 5: '⅝', 7: '⅞' },
};

/** Denominators a cook actually measures in, simplest first. */
const DENOMINATORS = [2, 3, 4, 8];

/** Below this, a difference is float noise rather than a real amount. */
const EPSILON = 1e-6;

/**
 * Rounds to the nearest fraction a measuring cup can express.
 *
 * Deliberately not a generic rational approximation: a cook has halves, thirds,
 * quarters and eighths, and showing them 5/7 of a cup would be worse than being
 * slightly wrong.
 */
export function roundToKitchenFraction(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  const value = Math.abs(amount);

  let best = Math.round(value);
  let bestError = Math.abs(value - best);

  for (const denominator of DENOMINATORS) {
    const rounded = Math.round(value * denominator) / denominator;
    const error = Math.abs(value - rounded);
    // Strictly better only — so a value expressible in halves never gets
    // rendered in eighths.
    if (error < bestError - EPSILON) {
      best = rounded;
      bestError = error;
    }
  }

  return sign * best;
}

/**
 * Rounds to something the unit can actually express.
 *
 * Eggs are countable: two thirds of an egg is not an instruction, it is a
 * rounding artefact that ends up on screen. Grams and millilitres are read off
 * a scale, so whole numbers. Everything else is measured in cups and spoons.
 */
export function roundForUnit(amount: number, unit: Unit): number {
  if (unit === 'each') return Math.max(0, Math.round(amount));
  if (unit === 'g' || unit === 'ml') return Math.round(amount);
  return roundToKitchenFraction(amount);
}

const PLURAL: Record<Unit, { one: string; many: string; spaced: boolean }> = {
  cup: { one: 'cup', many: 'cups', spaced: true },
  tsp: { one: 'tsp', many: 'tsp', spaced: true },
  tbsp: { one: 'tbsp', many: 'tbsp', spaced: true },
  g: { one: 'g', many: 'g', spaced: false },
  ml: { one: 'ml', many: 'ml', spaced: false },
  each: { one: '', many: '', spaced: false },
};

/** "3⅓", "½", "2" — the number alone, as a cook would write it. */
export function formatAmount(amount: number): string {
  const rounded = roundToKitchenFraction(amount);
  const sign = rounded < 0 ? '-' : '';
  const value = Math.abs(rounded);

  const whole = Math.floor(value + EPSILON);
  const remainder = value - whole;
  if (remainder < EPSILON) return `${sign}${whole}`;

  for (const denominator of DENOMINATORS) {
    const numerator = Math.round(remainder * denominator);
    if (Math.abs(remainder - numerator / denominator) < EPSILON) {
      const glyph = GLYPHS[denominator]?.[numerator];
      if (glyph) return whole === 0 ? `${sign}${glyph}` : `${sign}${whole}${glyph}`;
    }
  }

  // Not expressible as a kitchen fraction — show a decimal rather than lie.
  return `${sign}${Number(value.toFixed(2))}`;
}

/** "3⅓ cups", "1 tsp", "3" (for eggs), "250g". */
export function formatQuantity({ amount, unit }: Quantity): string {
  const rounded = roundForUnit(amount, unit);
  const text = formatAmount(rounded);
  const plural = PLURAL[unit];
  if (plural.one === '') return text;

  const word = Math.abs(rounded) === 1 ? plural.one : plural.many;
  return plural.spaced ? `${text} ${word}` : `${text}${word}`;
}
