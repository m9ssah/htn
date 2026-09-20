import type { FieldSpec, LeafComponent } from './contract.js';

/**
 * Which fields of each leaf Stage 2 is allowed to write, and which are
 * business facts that must arrive through `fixed`/`sourceFacts` instead.
 *
 * The boundary is the contract's, not a per-field guess: "Arithmetic, prices,
 * quantities, progress percentages, slider ranges/current values, toggle
 * state, URLs, and other authoritative business facts are provided through
 * fixed or sourceFacts; the model only generates fields explicitly listed
 * under fields." Every field below that is fixed-only is fixed for that
 * reason, not because it happened to be optional.
 *
 * This is Stage 2's catalog, not Stage 1's. It says nothing about layout,
 * hardware eligibility or contrast — that analyzer belongs to the json-render
 * migration and reads a different structure (the Spec), not this one.
 */
export type ComponentCatalogEntry = {
  /** Field templates Stage 2 may be asked to fill, in a stable order. */
  generatable: FieldSpec[];
  /** Named here so a synthetic target can put a plausible business fact in
   *  `fixed` for every field the model itself never touches. */
  fixedOnly: string[];
};

const text = (
  name: string,
  required: boolean,
  maxLength: number,
  minLength = 1,
): FieldSpec => ({
  name,
  type: 'string',
  required,
  constraints: { minLength, maxLength, format: 'plain-text' },
});

export const CATALOG: Record<LeafComponent, ComponentCatalogEntry> = {
  Heading: { generatable: [text('text', true, 60)], fixedOnly: [] },
  Text: { generatable: [text('text', true, 220)], fixedOnly: [] },
  Label: { generatable: [text('text', true, 24)], fixedOnly: [] },
  // value/delta are computed numbers ("60 cookies", "you planned for 30") —
  // arithmetic, so fixed. label is the short descriptive phrase beside them.
  Metric: { generatable: [text('label', true, 28)], fixedOnly: ['value', 'delta'] },
  Media: { generatable: [text('caption', false, 40)], fixedOnly: ['src'] },
  Badge: { generatable: [text('text', true, 16)], fixedOnly: [] },
  // meta is a price, a time, a count — always a business fact.
  ListItem: {
    generatable: [text('title', true, 40), text('detail', false, 60)],
    fixedOnly: ['meta'],
  },
  Bars: { generatable: [], fixedOnly: ['values'] },
  Rule: { generatable: [text('left', true, 40), text('right', false, 20)], fixedOnly: [] },
  Button: { generatable: [text('text', true, 24)], fixedOnly: [] },
  // value is what the USER typed, never generated; label/placeholder are copy.
  TextField: {
    generatable: [text('label', true, 24), text('placeholder', false, 40)],
    fixedOnly: ['value'],
  },
  // on is a state, not copy.
  Toggle: { generatable: [text('label', true, 32)], fixedOnly: ['on'] },
  Progress: { generatable: [], fixedOnly: ['pct'] },
  Alert: { generatable: [text('text', true, 140)], fixedOnly: [] },
  // min/max/step/value/unit are the axis's arithmetic; only the words are copy.
  Slider: {
    generatable: [text('label', true, 24), text('minLabel', false, 16), text('maxLabel', false, 16)],
    fixedOnly: ['min', 'max', 'step', 'value', 'unit'],
  },
};

/** Every field name Stage 2 is permitted to generate for a component. */
export function generatableFieldNames(component: LeafComponent): Set<string> {
  return new Set(CATALOG[component].generatable.map((f) => f.name));
}

/**
 * `Heading` gets 1-3 levels, `Button` gets primary/secondary/ghost, a
 * `ListItem` may or may not reserve a detail line. None of this is generated —
 * it varies what a synthetic target puts in `fixed`, so the dataset exercises
 * the layout-level variants a real Stage 1 spec would also produce, without
 * Stage 2 ever seeing or influencing them.
 */
export const FIXED_VARIANTS: Partial<Record<LeafComponent, Record<string, unknown[]>>> = {
  Heading: { level: [1, 2, 3] },
  Text: { tone: ['default', 'muted'] },
  Button: { variant: ['primary', 'secondary', 'ghost'] },
  ListItem: { hasDetail: [true, false], hasAction: [true, false] },
};
