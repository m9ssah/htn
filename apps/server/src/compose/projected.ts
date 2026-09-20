import {
  BUTTON_COUNT_V2,
  RANGE_CONTROL_COUNT_V2,
  SurfaceSpecSchema,
  type ContentUpdateV2,
  type JsonValue,
  type LeafComponentV2,
  type StructuralComponentV2,
  type StructureUpdateV2,
  type SurfaceSpec,
} from '@jit/schema';
import {
  currentYield,
  describeDeviation,
  describeQuantity,
  estimateCost,
  findDeviations,
  ingredientById,
  plannedAmount,
  planScaleUp,
  type Ingredient,
  type TaskState,
} from '../domain/recipe.js';
import { formatDuration, readTimer, timerFor } from '../domain/timer.js';
import { createBudget, estimateSpecHeight, GAP_PX, leafHeight, type HeightBudget } from './height.js';
import type { ChoiceOption, Contact } from '../seed.js';
import type { StructureComposer } from '../contract/compose.js';

/**
 * The deterministic surface composer. **Zero model calls.**
 *
 * The model-backed path (`jevStructureComposer`) asks a per-candidate
 * membership question, so Jev can silently omit the "eggs" row from a recipe.
 * For a surface the domain already fully determines — a recipe, a step, a
 * recovery beat, a done screen — that is the wrong question to ask: TypeScript
 * builds the spec directly from typed task state, so a domain-required element
 * is not omittable and there is no latency to cover.
 *
 * CLAUDE.md constraint 2 holds literally here: every number on screen
 * (quantities, yields, scale factors, prices, step counts) is computed in
 * `../domain/` and lands in the spec as a **fixed prop**. Only human-readable
 * copy is a `$state` binding, and even that copy's numbers come from
 * `describeQuantity`/`estimateCost`, never from a language model.
 */

/* ------------------------------------------------------------------ *
 * The contract this composer satisfies
 * ------------------------------------------------------------------ */

/**
 * The seam is imported directly now. It was originally mirrored structurally
 * because `orchestration.ts` was mid-move and an import of a moving file is a
 * build break waiting to happen; that move has landed, and a real import is
 * what keeps the two shapes from drifting — a structural mirror silently
 * stopped matching the moment `ComposeEvent` gained its `unavailable` arm.
 */
export type StructureComposerLike = StructureComposer;

/* ------------------------------------------------------------------ *
 * What the renderer actually accepts
 * ------------------------------------------------------------------ */

/**
 * Mirrored from `packages/renderer/src/json-renderer.tsx`'s `validateSpec`,
 * which rejects a spec the device would otherwise try to paint. Checking them
 * HERE is the difference between a loud compose failure and a surface the
 * renderer refuses at paint time.
 */
const MAX_ELEMENTS = 24;
const MAX_DEPTH = 4;

/**
 * The string props each leaf may receive from a content update, mirroring the
 * (unexported) `GENERATED_FIELDS` table in `../orchestration.js`. A `$state`
 * pointer whose last segment is not in this list yields no content target —
 * an element that shimmers forever (ADR 0001, inherited defect 2).
 *
 * `Bars` and `Progress` are deliberately absent: they have no content support
 * at all, so they are driven from fixed props only and never carry a
 * `pending` binding.
 */
const COPY_FIELDS: Record<LeafComponentV2, readonly string[]> = {
  Heading: ['text'],
  Text: ['text'],
  Label: ['text'],
  Metric: ['label', 'value', 'delta'],
  Media: ['caption'],
  Badge: ['text'],
  ListItem: ['title', 'detail', 'meta'],
  Bars: [],
  Rule: ['left', 'right'],
  Button: ['text'],
  TextField: ['label', 'placeholder'],
  Toggle: ['label'],
  Progress: [],
  Alert: ['text'],
  Slider: ['label', 'minLabel', 'maxLabel'],
};

/** Same mapping the renderer uses to decide what a leaf costs on the rail. */
function actionKind(type: LeafComponentV2 | StructuralComponentV2): 'press' | 'toggle' | 'text' | 'range' | null {
  if (type === 'Button' || type === 'ListItem') return 'press';
  if (type === 'Toggle') return 'toggle';
  if (type === 'TextField') return 'text';
  if (type === 'Slider') return 'range';
  return null;
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

/** The ONLY place a `$state` pointer is written, so rule 2 holds by construction. */
const pointer = (key: string, field: string): string => `/content/${key}/${field}`;

type LeafInput = {
  key: string;
  type: LeafComponentV2;
  /** Human-readable copy. Becomes a `$state` binding + a content value. */
  copy?: Record<string, string>;
  /** Everything a user could check — numbers, flags, enums. Stays a fixed prop. */
  fixed?: Record<string, JsonValue>;
  /**
   * Fields bound to `/content/...` with NOTHING behind them yet — the slot
   * shimmers until a content patch lands. `copy` is for a value this composer
   * already knows; this is for one only a model can write.
   */
  generate?: readonly string[];
  /** `reserveLines`, 1–4. */
  lines?: number;
  /** Binds this leaf to the hardware rail. Must be unique within the spec. */
  action?: string;
};

class SurfaceBuilder {
  private readonly elements: SurfaceSpec['elements'] = {};
  private readonly seed: Record<string, Record<string, JsonValue>> = {};
  private readonly values: Record<string, Record<string, JsonValue>> = {};
  readonly warnings: string[] = [];

  /**
   * The panel's remaining vertical space. Every `leaf` spends from it, so a
   * template can ask `canFit` before committing to another row instead of
   * discovering the overflow on the device (see `./height.ts`).
   */
  readonly budget: HeightBudget;

  /**
   * `now` is injected rather than read from `Date.now()` inside a surface, so
   * a timer's rendered output is a function of its inputs and a test can
   * assert the screen at a chosen instant.
   */
  /**
   * `enforce` decides whether the budget may actually drop rows, and defaults
   * to off. Measuring is always safe; TRIMMING changes what is on screen, and
   * on this panel a strict budget leaves `item_detail` with zero ingredient
   * rows — so which surfaces may shrink, and to what, is a decision for
   * whoever owns the demo rather than a default.
   */
  constructor(
    readonly now: number = Date.now(),
    maxHeight: number = DEFAULT_MAX_HEIGHT,
    private readonly enforce: boolean = false,
  ) {
    this.budget = createBudget(maxHeight);
  }

  /** How many of `total` rows may be shown. The cap, unless enforcing. */
  rowCapacity(total: number, unenforced: number, cap: number, rowHeight: number, foldHeight: number, tail: number): number {
    if (!this.enforce) return unenforced;
    for (let n = Math.min(cap, total); n >= 0; n -= 1) {
      const folds = n < total;
      const count = n + (folds ? 1 : 0);
      const height = n * rowHeight + (folds ? foldHeight : 0) + GAP_PX * Math.max(0, count - 1);
      if (count === 0 || this.budget.fits(height, tail)) return Math.max(n, Math.min(MIN_ROWS, total));
    }
    return Math.min(MIN_ROWS, total);
  }

  /** True unless enforcement is on and the component would not fit. */
  mayAdd(height: number, tail = 0): boolean {
    return !this.enforce || this.budget.fits(height, tail);
  }

  /** Would one more component of this shape still fit on the panel? */
  canFit(type: LeafComponentV2, options: { lines?: number; hasDetail?: boolean } = {}): boolean {
    return this.budget.fits(leafHeight(type, options));
  }

  /**
   * Writes a content value the COMPOSER computed, for a prop bound to
   * `/content/...` that is not a generated field.
   *
   * `leaf`'s `copy` is for model-fillable strings; this is for a number the
   * server owns but still wants to be able to update later — the timer's
   * progress, which has to be re-sent every second to move.
   */
  seedContent(key: string, values: Record<string, JsonValue>): this {
    this.values[key] = { ...(this.values[key] ?? {}), ...values };
    this.seed[key] = { ...(this.seed[key] ?? {}), ...values };
    return this;
  }

  container(key: string, type: StructuralComponentV2, children?: string[]): this {
    this.elements[key] = { type, props: {}, ...(children ? { children } : {}) };
    return this;
  }

  leaf(item: LeafInput): this {
    const copy = Object.fromEntries(
      Object.entries(item.copy ?? {}).filter(([, value]) => value !== undefined && value !== null),
    );
    const bindable = COPY_FIELDS[item.type];
    const generated = (item.generate ?? []).filter((field) => bindable.includes(field));
    const bound = [...new Set([...Object.keys(copy).filter((f) => bindable.includes(f)), ...generated])];
    for (const field of Object.keys(copy)) {
      if (!bindable.includes(field)) {
        this.warnings.push(`${item.key}: "${field}" is not a generated field of ${item.type} — dropped`);
      }
    }

    const props: Record<string, JsonValue | { $state: string }> = {
      id: item.key,
      ...(item.lines !== undefined ? { reserveLines: item.lines } : {}),
      ...(item.fixed ?? {}),
    };
    // A `pending` binding with no content behind it shimmers forever, so a
    // leaf with nothing to fill in never gets one.
    if (bound.length > 0) props.pending = { $state: pointer(item.key, 'pending') };
    for (const field of bound) props[field] = { $state: pointer(item.key, field) };

    // Spend before recording, so `canFit` is answered against what is
    // actually on the surface rather than what a template intended.
    this.budget.spend(leafHeight(item.type, {
      ...(item.lines !== undefined ? { lines: item.lines } : {}),
      ...(item.fixed?.['hasDetail'] === true ? { hasDetail: true } : {}),
    }));

    this.elements[item.key] = {
      type: item.type,
      props,
      ...(item.action ? { on: { [actionKind(item.type) ?? 'press']: { action: item.action } } } : {}),
    };

    if (bound.length > 0) {
      this.seed[item.key] = { pending: true, ...Object.fromEntries(bound.map((field) => [field, ''])) };
      this.values[item.key] = Object.fromEntries(bound.map((field) => [field, copy[field]!]));
    }
    return this;
  }

  build(root: string): { spec: SurfaceSpec; values: ContentUpdateV2['values'] } {
    return {
      spec: { root, elements: this.elements, state: { content: this.seed } },
      values: this.values,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Validation — loud, before anything reaches the renderer
 * ------------------------------------------------------------------ */

/**
 * Every reason a projected surface may not ship. Returns `null` when the spec
 * is safe to paint.
 *
 * The action counts matter more than they look: `getActions()` returns `[]`
 * *silently* when a surface exceeds the hardware (two bare `return []` in
 * `json-renderer.tsx`, no telemetry, no reason). The rail goes dark and
 * nothing says why. Catching it here is the only place it is visible.
 */
export function validateProjectedSpec(spec: SurfaceSpec, values: ContentUpdateV2['values']): string | null {
  const parsed = SurfaceSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `spec is not schema-valid: ${issue?.path.join('.') ?? '?'} — ${issue?.message ?? 'unknown'}`;
  }
  if (!spec.elements[spec.root]) return `root element "${spec.root}" is missing`;
  const count = Object.keys(spec.elements).length;
  if (count > MAX_ELEMENTS) return `${count} elements exceeds the device maximum of ${MAX_ELEMENTS}`;

  // Reachability, cycles and depth, walked exactly as the renderer walks them.
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (id: string, depth: number): string | null => {
    if (depth > MAX_DEPTH) return `tree depth exceeds the device maximum of ${MAX_DEPTH} at "${id}"`;
    if (visiting.has(id)) return `spec contains a cycle at "${id}"`;
    const element = spec.elements[id];
    if (!element) return `missing child element: "${id}"`;
    if (seen.has(id)) return null;
    seen.add(id);
    visiting.add(id);
    order.push(id);
    for (const child of element.children ?? []) {
      const error = visit(child, depth + 1);
      if (error) return error;
    }
    visiting.delete(id);
    return null;
  };
  const walkError = visit(spec.root, 1);
  if (walkError) return walkError;
  if (seen.size !== count) {
    const orphans = Object.keys(spec.elements).filter((id) => !seen.has(id));
    return `unreachable element(s): ${orphans.join(', ')}`;
  }

  const ids = new Set<string>();
  const actions = new Set<string>();
  let buttons = 0;
  let ranges = 0;
  for (const id of order) {
    const element = spec.elements[id]!;
    const propId = element.props.id;
    if (typeof propId === 'string') {
      if (propId !== id) return `element "${id}" carries props.id "${propId}" — they must be equal`;
      if (ids.has(propId)) return `duplicate props.id: "${propId}"`;
      ids.add(propId);
    }

    const kind = actionKind(element.type);
    const binding = kind ? element.on?.[kind] : undefined;
    if (binding) {
      if (actions.has(binding.action)) return `duplicate action: "${binding.action}"`;
      actions.add(binding.action);
      if (kind === 'range') ranges += 1;
      else buttons += 1;
    }
    for (const [event, bound] of Object.entries(element.on ?? {})) {
      if (event !== kind) return `element "${id}" (${element.type}) binds "${event}", which the device never fires`;
      void bound;
    }

    // Pointer discipline: the content-derivation code matches on BOTH the
    // element segment and the field segment, so a mismatch produces an
    // element that shimmers forever.
    const bindable = COPY_FIELDS[element.type as LeafComponentV2] ?? [];
    for (const [prop, value] of Object.entries(element.props)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('$state' in value)) continue;
      const path = (value as { $state: string }).$state;
      const match = /^\/content\/([^/]+)\/([^/]+)$/.exec(path);
      if (!match) return `element "${id}" prop "${prop}" has a malformed pointer: ${path}`;
      const [, element_, field] = match as unknown as [string, string, string];
      if (element_ !== id) return `element "${id}" prop "${prop}" points at "${element_}"`;
      if (field !== prop) return `element "${id}" prop "${prop}" points at field "${field}"`;
      /**
       * A binding must have something behind it. Usually that means a
       * generated field, but the composer may also bind a prop it computes
       * ITSELF and intends to re-send — the timer's `pct`, which has to move
       * once a second. The invariant that matters is the next line: never a
       * binding with no content, i.e. never a permanent shimmer. Being a
       * generated field is one way to satisfy it, not the only way.
       */
      const seeded = values[id]?.[field] !== undefined;
      if (field !== 'pending' && !bindable.includes(field) && !seeded) {
        return `element "${id}" binds "${field}", which is neither a generated field of ${element.type} nor seeded by the composer`;
      }
      // ADR 0001's added invariant: never a permanent shimmer.
      if (!(id in values)) return `element "${id}" binds content but no content value was produced`;
    }
  }

  if (buttons > BUTTON_COUNT_V2) {
    return `${buttons} press/toggle/text actions exceeds the hardware's ${BUTTON_COUNT_V2} — getActions() would return [] silently`;
  }
  if (ranges > RANGE_CONTROL_COUNT_V2) {
    return `${ranges} range actions exceeds the hardware's ${RANGE_CONTROL_COUNT_V2} — getActions() would return [] silently`;
  }

  for (const key of Object.keys(values)) {
    if (!spec.elements[key]) return `content produced for unknown element "${key}"`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The four (plus two) projected surfaces
 * ------------------------------------------------------------------ */

/**
 * How many ingredient rows `item_detail` carries before the rest are folded up.
 *
 * Derived from the device's element budget, NOT from the 4" screen height:
 * `apps/device/src/shell.css` gives `.surface` `overflow: hidden auto`, so a
 * row below the fold is scrolled to, not lost. A lower cap therefore buys no
 * legibility and costs completeness — the retired contract's 8 reserved slots
 * would make the seeded 9-ingredient demo recipe render "+2 more ingredients"
 * on its main screen every single time. `item_detail` spends
 * `ITEM_DETAIL_FIXED_ELEMENTS` on everything that is not a row; the rest of
 * the 24 is available, and this leaves headroom inside it.
 */
export const MAX_INGREDIENT_ROWS = 10;
/**
 * card, row, left, right, title, subtitle, batch, ingredients_label, start,
 * and the four of the cost breakdown. Two columns cost two more containers
 * than the single stack did, which is why the row cap came down with it.
 */
export const ITEM_DETAIL_FIXED_ELEMENTS = 13;
/** Exported so a test can hold `MAX_INGREDIENT_ROWS` to the real device cap. */
export const MAX_SURFACE_ELEMENTS = MAX_ELEMENTS;
/** How many of a step's additions get their own row. */
const MAX_STEP_DETAILS = 3;
/**
 * The budget folds rows to fit the panel, but never to nothing.
 *
 * `item_detail`'s header alone (title, yield line, batch slider, label) plus
 * its primary button is 229px of a 262px content budget, so a strict budget
 * leaves room for zero ingredients — a recipe screen with no ingredients on
 * it, which is a worse answer than one that overflows. Below this floor the
 * surface keeps its rows and the overflow is reported instead.
 */
const MIN_ROWS = 3;

/**
 * The action vocabulary these surfaces emit. **Nothing dispatches on these
 * names yet** — `apps/device/src/rail.ts` maps a descriptor to a button by
 * INDEX and never reads `.action`, so whoever wires the rail to task state is
 * free to rename them, but must rename them here and nowhere else.
 *
 * Names are aligned with `packages/renderer/src/examples.ts`, the only other
 * place in the repo that spells them, so the two do not drift into synonyms:
 *
 *   item_detail    set_amount (range) · begin
 *   focus_step     prev_step · next_step | step_done
 *   recovery       start_over · apply_fix
 *   summary_done   share
 *   choice_cards   set_preference (range) · select_<optionId>
 *   people_picker  choose_<contactId> · write_messages
 *
 * `select_`/`choose_` are suffixed with the domain id rather than a row number
 * (`examples.ts` uses `select_1`), so reordering the list cannot silently
 * repoint a button at a different thing.
 */
export type ProjectedInput =
  | { kind: 'item_detail'; state: TaskState }
  | { kind: 'focus_step'; state: TaskState }
  | { kind: 'recovery'; state: TaskState }
  | { kind: 'summary_done'; state: TaskState }
  | { kind: 'choice_cards'; options: readonly ChoiceOption[] }
  | { kind: 'people_picker'; contacts: readonly Contact[]; chosen?: readonly string[] }
  | { kind: 'show_me'; subject: string; media: { url: string; kind: 'video' | 'image' } | null; caption: string };

export type ProjectedSurfaceKind = ProjectedInput['kind'];

export const PROJECTED_SURFACES: readonly ProjectedSurfaceKind[] = [
  'item_detail', 'focus_step', 'recovery', 'summary_done', 'choice_cards', 'people_picker', 'show_me',
];

export const isProjectedSurface = (kind: string): kind is ProjectedSurfaceKind =>
  (PROJECTED_SURFACES as readonly string[]).includes(kind);

/**
 * Ingredient rows, honestly overflowed.
 *
 * More ingredients than rows is not a truncation: the last row becomes an
 * explicit "+N more" that names every ingredient it stands for, and a warning
 * says so. Dropping the 9th ingredient silently is exactly the failure the
 * deterministic path exists to make impossible.
 */
function ingredientRows(state: TaskState, builder: SurfaceBuilder): string[] {
  const { ingredients } = state.recipe;
  const cost = new Map(estimateCost(state).lines.map((line) => [line.id, line.cost]));
  const row = (ingredient: Ingredient, index: number): string => {
    const key = `ing_${index}`;
    const price = cost.get(ingredient.id);
    builder.leaf({
      key,
      type: 'ListItem',
      copy: {
        title: ingredient.name,
        meta: describeQuantity({ amount: plannedAmount(state, ingredient.id), unit: ingredient.unit }),
        ...(price !== undefined ? { detail: `$${price.toFixed(2)}` } : {}),
      },
      fixed: { hasDetail: price !== undefined },
    });
    return key;
  };

  /**
   * The row cap was an ELEMENT budget (the renderer refuses past 24). The
   * panel imposes a tighter one: twelve rows is 612px against a 364px stage.
   * `capacity` is the largest count that still leaves room for the fold row
   * and the primary action.
   */
  const capacity = builder.rowCapacity(
    ingredients.length,
    ingredients.length <= MAX_INGREDIENT_ROWS ? ingredients.length : MAX_INGREDIENT_ROWS - 1,
    MAX_INGREDIENT_ROWS,
    leafHeight('ListItem', { hasDetail: true }),
    leafHeight('ListItem', { hasDetail: true }),
    leafHeight('Button'),
  );

  if (ingredients.length <= capacity) return ingredients.map(row);

  const shown = ingredients.slice(0, capacity).map(row);
  const rest = ingredients.slice(capacity);
  builder.leaf({
    key: `ing_${capacity}`,
    type: 'ListItem',
    copy: { title: `+${rest.length} more ingredients`, detail: rest.map((i) => i.name).join(', ') },
    fixed: { hasDetail: true },
  });
  builder.warnings.push(
    `item_detail: ${rest.length} ingredient(s) did not fit the panel and are ` +
      `named on the final row instead: ${rest.map((i) => i.name).join(', ')}`,
  );
  return [...shown, `ing_${capacity}`];
}

/**
 * What the batch costs, and where the money goes.
 *
 * `Bars` takes 1–12 values, so the chart shows the priciest ingredients and
 * folds the tail into one "other" bar rather than dropping it — a cost chart
 * whose bars do not sum to the total beside them is a chart that invites
 * exactly the question you cannot answer on stage.
 *
 * Every number here comes from `estimateCost` (constraint 2). `Bars.values`
 * and `Metric.value` are facts, so they are fixed props, never generated.
 */
function costBreakdown(
  state: TaskState,
  cost: ReturnType<typeof estimateCost>,
  builder: SurfaceBuilder,
): string[] {
  const lines = [...cost.lines].filter((line) => line.cost > 0).sort((a, b) => b.cost - a.cost);
  if (lines.length === 0) {
    builder.warnings.push('item_detail: no priced ingredients, so no cost breakdown');
    return [];
  }

  const MAX_BARS = 6;
  const head = lines.slice(0, MAX_BARS - 1);
  const tail = lines.slice(MAX_BARS - 1);
  const tailCost = tail.reduce((sum, line) => sum + line.cost, 0);
  const shown = tail.length > 0 ? [...head, { id: 'other', cost: tailCost }] : head.concat(lines.slice(head.length));

  builder.leaf({ key: 'cost_label', type: 'Label', copy: { text: 'Cost per batch' } });
  builder.leaf({
    key: 'cost_total',
    type: 'Metric',
    copy: {
      label: `$${cost.total.toFixed(2)} total`,
      value: `$${(cost.total / Math.max(1, currentYield(state))).toFixed(2)}`,
      delta: `per ${state.recipe.yieldUnit.replace(/s$/, '')}`,
    },
  });
  builder.leaf({
    key: 'cost_bars',
    type: 'Bars',
    fixed: { values: shown.map((line) => Number(line.cost.toFixed(2))) },
  });
  builder.leaf({
    key: 'cost_legend',
    type: 'Text',
    copy: {
      text: shown
        .map((line) => `${line.id === 'other' ? `${tail.length} others` : ingredientById(state.recipe, line.id)?.name ?? line.id} $${line.cost.toFixed(2)}`)
        .join(' · '),
    },
    fixed: { tone: 'muted' },
    lines: 2,
  });
  return ['cost_label', 'cost_total', 'cost_bars', 'cost_legend'];
}

function itemDetail(state: TaskState, builder: SurfaceBuilder): string {
  const { recipe } = state;
  const cost = estimateCost(state);
  builder.leaf({ key: 'title', type: 'Heading', copy: { text: recipe.name }, fixed: { level: 1 } });
  builder.leaf({
    key: 'subtitle',
    type: 'Text',
    copy: { text: `${currentYield(state)} ${recipe.yieldUnit} · ${recipe.minutes} min · $${cost.total.toFixed(2)}` },
    fixed: { tone: 'muted' },
  });
  builder.leaf({
    key: 'batch',
    type: 'Slider',
    copy: { label: 'Batch size' },
    fixed: {
      min: recipe.baseYield,
      max: recipe.baseYield * 3,
      step: Math.max(1, Math.round(recipe.baseYield / 3)),
      value: currentYield(state),
      unit: recipe.yieldUnit,
    },
    action: 'set_amount',
  });
  builder.leaf({ key: 'ingredients_label', type: 'Label', copy: { text: 'Ingredients' } });
  const rows = ingredientRows(state, builder);
  if (rows.length === 0) builder.warnings.push('item_detail: the recipe has no ingredients to show');
  // The chart is enrichment, not the task. It yields to the ingredient rows
  // and the primary action rather than pushing either off the panel.
  const costKeys = builder.mayAdd(
    leafHeight('Label') + leafHeight('Metric') + leafHeight('Bars') + leafHeight('Text', { lines: 2 }) + GAP_PX * 3,
    leafHeight('Button'),
  )
    ? costBreakdown(state, cost, builder)
    : [];
  if (costKeys.length === 0) builder.warnings.push('item_detail: no room for the cost breakdown on this panel');
  builder.leaf({ key: 'start', type: 'Button', copy: { text: 'Start cooking' }, fixed: { variant: 'primary' }, action: 'begin' });

  // What you decide on the left, what it is made of on the right.
  builder.container('left', 'Stack', ['title', 'subtitle', 'batch', ...costKeys, 'start']);
  builder.container('right', 'Stack', ['ingredients_label', ...rows]);
  builder.container('row', 'Row', ['left', 'right']);
  builder.container('card', 'Card', ['row']);
  return 'card';
}

/** "2 cups flour, 3 eggs" — what is actually in the bowl right now. */
function bowlSummary(state: TaskState): string {
  const entries = Object.entries(state.inBowl).filter(([, amount]) => Number.isFinite(amount) && amount > 0);
  if (entries.length === 0) return 'The bowl is empty.';
  const parts = entries.map(([id, amount]) => {
    const ingredient = ingredientById(state.recipe, id);
    if (!ingredient) return id;
    return `${describeQuantity({ amount, unit: ingredient.unit })} ${ingredient.name.toLowerCase()}`;
  });
  return `In the bowl: ${parts.join(', ')}.`;
}

function focusStep(state: TaskState, builder: SurfaceBuilder): string {
  const { recipe, stepIndex } = state;
  const step = recipe.steps[stepIndex];
  const total = recipe.steps.length;
  const isLast = stepIndex >= total - 1;
  if (!step) builder.warnings.push(`focus_step: stepIndex ${stepIndex} is past the last step (${total})`);

  builder.leaf({
    key: 'progress',
    type: 'Label',
    copy: { text: step ? `Step ${stepIndex + 1} of ${total}` : `All ${total} steps complete` },
  });
  builder.leaf({
    key: 'instruction',
    type: 'Heading',
    copy: { text: step?.instruction ?? 'All steps complete' },
    fixed: { level: 1 },
    lines: 2,
  });

  const adds = step?.adds ?? [];
  /**
   * What this surface must still have room for once the rows are placed: the
   * bowl line, the buttons, and the timer when the step declares one. Rows are
   * dropped before any of those are, because a step you cannot advance is
   * worse than a step that names one fewer ingredient.
   */
  const tail = leafHeight('Text', { lines: 2 })
    + leafHeight('Button')
    + (step && timerFor(step, builder.now) ? leafHeight('Metric') + leafHeight('Progress') : 0);

  /**
   * The largest number of rows that fits INCLUDING the fold row the remainder
   * needs. Counting rows first and folding afterwards gives the worse surface:
   * "Butter" alone tells you less than "+3 more: Butter, Caster sugar, Brown
   * sugar" in the same space.
   */
  const capacity = builder.rowCapacity(
    adds.length,
    Math.min(MAX_STEP_DETAILS, adds.length),
    MAX_STEP_DETAILS,
    leafHeight('ListItem'),
    leafHeight('ListItem', { hasDetail: true }),
    tail,
  );
  const shown = adds.slice(0, capacity);
  if (adds.length > shown.length) {
    builder.warnings.push(
      `focus_step: step ${stepIndex + 1} adds ${adds.length} ingredients, ${shown.length} row(s) fit the panel`,
    );
  }
  const detailKeys = shown.map((id, index) => {
    const key = `add_${index}`;
    const ingredient = ingredientById(recipe, id);
    builder.leaf({
      key,
      type: 'ListItem',
      copy: {
        title: ingredient?.name ?? id,
        ...(ingredient
          ? { meta: describeQuantity({ amount: plannedAmount(state, id), unit: ingredient.unit }) }
          : {}),
      },
    });
    return key;
  });
  if (adds.length > shown.length) {
    const rest = adds.slice(shown.length).map((id) => ingredientById(recipe, id)?.name ?? id);
    // The fold row is itself a row. If even it does not fit beside the bowl
    // and the buttons, the ingredients stay named in the warning rather than
    // pushing the primary action off the panel.
    if (builder.mayAdd(leafHeight('ListItem', { hasDetail: true }), tail)) {
      const key = `add_${shown.length}`;
      builder.leaf({
        key,
        type: 'ListItem',
        copy: { title: `+${rest.length} more`, detail: rest.join(', ') },
        fixed: { hasDetail: true },
      });
      detailKeys.push(key);
    } else {
      builder.warnings.push(`focus_step: no room even to fold ${rest.length} ingredient(s): ${rest.join(', ')}`);
    }
  }

  /**
   * A timer only where the step declares a real duration, and only counting
   * once someone has started it — arriving at "chill the dough for 20
   * minutes" is not the same as having put it in the fridge.
   *
   * `pct` is bound to content rather than fixed so the bar can be ticked by a
   * later content patch. That is not a model writing a number: the server
   * computes every value here (constraint 2), and `Progress` still declares
   * no generated field, so `deriveContentRequest` never offers it to one.
   */
  const timerKeys: string[] = [];
  const seconds = step?.seconds;
  if (seconds !== undefined) {
    if (state.timerStartedAt === undefined) {
      builder.leaf({
        key: 'timer_start',
        type: 'Button',
        copy: { text: `Start ${formatDuration(seconds * 1000)} timer` },
        fixed: { variant: 'secondary' },
        action: 'start_timer',
      });
      timerKeys.push('timer_start');
    } else {
      const timer = { startedAt: state.timerStartedAt, durationMs: seconds * 1000 };
      const reading = readTimer(timer, builder.now);
      builder.leaf({
        key: 'timer_remaining',
        type: 'Metric',
        copy: { label: reading.done ? 'Timer done' : 'Time left', value: formatDuration(reading.remainingMs) },
      });
      builder.leaf({
        key: 'timer_bar',
        type: 'Progress',
        fixed: { pct: { $state: '/content/timer_bar/pct' } as unknown as JsonValue },
      });
      builder.seedContent('timer_bar', { pct: Math.round(reading.pct) });
      timerKeys.push('timer_remaining', 'timer_bar');
    }
  }

  builder.leaf({ key: 'bowl', type: 'Text', copy: { text: bowlSummary(state) }, fixed: { tone: 'muted' }, lines: 2 });

  const buttons: string[] = [];
  if (stepIndex > 0) {
    builder.leaf({ key: 'prev', type: 'Button', copy: { text: 'Back' }, fixed: { variant: 'ghost' }, action: 'prev_step' });
    buttons.push('prev');
  }
  if (step) {
    builder.leaf({
      key: 'next',
      type: 'Button',
      copy: { text: isLast ? 'Done' : 'Next' },
      fixed: { variant: 'primary' },
      action: isLast ? 'step_done' : 'next_step',
    });
    buttons.push('next');
  }

  /**
   * Two columns, because the task has two halves and the panel is landscape.
   *
   * Every surface used to be one `Card > Stack` column, so following a recipe
   * looked exactly like picking a contact — the layout carried no information
   * about what you were doing. Here the left column is the step you are on
   * and the controls to move through it; the right is what goes in the bowl
   * for THIS step. Side by side they are also half the height, which is what
   * gets this surface inside the 480px panel.
   *
   * `Card > Row > Stack > leaf` is exactly the device's depth limit of 4, so
   * the buttons sit directly in the left column rather than in a
   * `ButtonGroup` — one more level would be rejected at compose time.
   */
  builder.container('left', 'Stack', ['progress', 'instruction', ...timerKeys, ...buttons]);
  builder.container('right', 'Stack', [...(detailKeys.length > 0 ? ['adds_label'] : []), ...detailKeys, 'bowl']);
  if (detailKeys.length > 0) {
    builder.leaf({ key: 'adds_label', type: 'Label', copy: { text: 'Into the bowl' } });
  }
  builder.container('row', 'Row', ['left', 'right']);
  builder.container('card', 'Card', ['row']);
  return 'card';
}

/**
 * "Show me what that looks like."
 *
 * The media fills the right half at its own aspect ratio and the words sit
 * beside it — a layout that exists for exactly one purpose, which is the
 * point: a picture squeezed into the same column as everything else is not
 * showing you anything.
 *
 * When nothing was found it says so instead of painting an empty grey box,
 * because a blank frame reads as a broken device rather than as an empty
 * search (constraint 5).
 */
function showMe(
  input: { subject: string; media: { url: string; kind: 'video' | 'image' } | null; caption: string },
  builder: SurfaceBuilder,
): string {
  builder.leaf({ key: 'kind', type: 'Label', copy: { text: input.media?.kind === 'video' ? 'Clip' : 'Picture' } });
  builder.leaf({ key: 'subject', type: 'Heading', copy: { text: input.subject }, fixed: { level: 1 }, lines: 2 });
  builder.leaf({ key: 'note', type: 'Text', copy: { text: input.caption }, fixed: { tone: 'muted' }, lines: 2 });
  builder.leaf({ key: 'back', type: 'Button', copy: { text: 'Back to the recipe' }, fixed: { variant: 'secondary' }, action: 'back_to_task' });
  builder.container('left', 'Stack', ['kind', 'subject', 'note', 'back']);

  if (input.media) {
    builder.leaf({ key: 'shot', type: 'Media', copy: { caption: '' }, fixed: { src: input.media.url } });
    builder.container('right', 'Stack', ['shot']);
  } else {
    builder.leaf({ key: 'nothing', type: 'Alert', copy: { text: `Nothing found for "${input.subject}".` } });
    builder.container('right', 'Stack', ['nothing']);
    builder.warnings.push(`show_me: no media found for "${input.subject}"`);
  }

  builder.container('row', 'Row', ['left', 'right']);
  builder.container('card', 'Card', ['row']);
  return 'card';
}

function recovery(state: TaskState, builder: SurfaceBuilder): string {
  const worst = findDeviations(state)[0];
  const plan = planScaleUp(state);
  const scalingUp = plan.newYield > plan.previousYield;
  if (!worst) builder.warnings.push('recovery: nothing in the bowl deviates from the plan');

  const topups = plan.topups.map((t) => `${describeQuantity(t.add)} more ${t.name.toLowerCase()}`).join(', ');
  const planText = scalingUp
    ? topups
      ? `Scale the whole batch to ${plan.newYield} ${state.recipe.yieldUnit} — add ${topups} to catch up.`
      : `Scale the whole batch to ${plan.newYield} ${state.recipe.yieldUnit} to match.`
    : 'Nothing left to scale up to — starting over is the only fix that undoes what already went in.';

  builder.leaf({ key: 'kind', type: 'Label', copy: { text: 'Correction' } });
  builder.leaf({
    key: 'title',
    type: 'Heading',
    copy: { text: worst ? `${worst.name} looks off` : 'Nothing to correct' },
    fixed: { level: 1 },
  });
  builder.leaf({
    key: 'diagnosis',
    type: 'Alert',
    copy: { text: worst ? describeDeviation(worst) : 'Everything in the bowl matches the plan so far.' },
    lines: 3,
  });
  builder.leaf({ key: 'plan_label', type: 'Label', copy: { text: 'Recommended fix' } });
  builder.leaf({ key: 'plan', type: 'Text', copy: { text: planText }, lines: 3 });
  builder.leaf({
    key: 'outcome',
    type: 'Metric',
    copy: {
      label: `New ${state.recipe.yieldUnit}`,
      value: `${plan.newYield}`,
      ...(scalingUp ? { delta: `you planned for ${plan.previousYield}` } : {}),
    },
  });

  const buttons = ['restart'];
  builder.leaf({ key: 'restart', type: 'Button', copy: { text: 'Start over' }, fixed: { variant: 'secondary' }, action: 'start_over' });
  // `apply_fix` genuinely does not apply to an under-addition — you cannot
  // un-add flour — so the button is absent rather than present and wrong.
  if (scalingUp) {
    builder.leaf({
      key: 'fix',
      type: 'Button',
      copy: { text: `Scale up to ${plan.newYield}` },
      fixed: { variant: 'primary' },
      action: 'apply_fix',
    });
    buttons.push('fix');
  }
  builder.container('buttons', 'ButtonGroup', buttons);
  builder.container('stack', 'Stack', ['kind', 'title', 'diagnosis', 'plan_label', 'plan', 'outcome', 'buttons']);
  builder.container('card', 'Card', ['stack']);
  return 'card';
}

function summaryDone(state: TaskState, builder: SurfaceBuilder): string {
  const cost = estimateCost(state);
  builder.leaf({ key: 'title', type: 'Heading', copy: { text: `${state.recipe.name} is ready` }, fixed: { level: 1 } });
  builder.leaf({
    key: 'result',
    type: 'Metric',
    copy: { label: 'Made', value: `${currentYield(state)} ${state.recipe.yieldUnit}` },
  });
  builder.leaf({
    key: 'spend',
    type: 'Metric',
    copy: { label: 'Ingredients', value: `$${cost.total.toFixed(2)}`, delta: `${cost.lines.length} items` },
  });
  builder.leaf({ key: 'prompt', type: 'Text', copy: { text: 'What would you like to do next?' }, lines: 2 });
  builder.leaf({ key: 'share', type: 'Button', copy: { text: 'Share the extras' }, fixed: { variant: 'primary' }, action: 'share' });

  builder.container('stack', 'Stack', ['title', 'result', 'spend', 'prompt', 'share']);
  builder.container('card', 'Card', ['stack']);
  return 'card';
}

function choiceCards(options: readonly ChoiceOption[], builder: SurfaceBuilder): string {
  if (options.length === 0) builder.warnings.push('choice_cards: no options to choose between');
  builder.leaf({ key: 'title', type: 'Heading', copy: { text: 'What do you want to make?' }, fixed: { level: 1 } });
  builder.leaf({ key: 'subtitle', type: 'Text', copy: { text: 'Pick one to get started' }, fixed: { tone: 'muted' } });
  builder.leaf({
    key: 'effort',
    type: 'Slider',
    copy: { label: 'Effort', minLabel: 'Quick', maxLabel: 'Impressive' },
    fixed: { min: 0, max: 2, step: 1, value: options[Math.floor(options.length / 2)]?.effort ?? 1 },
    action: 'set_preference',
  });
  const keys = options.map((option, index) => {
    const key = `option_${index}`;
    builder.leaf({
      key,
      type: 'ListItem',
      copy: { title: option.title, detail: option.blurb, meta: `${option.minutes} min` },
      fixed: { interactive: true, hasDetail: true },
      action: `select_${option.id}`,
    });
    return key;
  });
  // The question on the left, the things you can pick on the right.
  builder.container('left', 'Stack', ['title', 'subtitle', 'effort']);
  builder.container('right', 'Stack', keys);
  builder.container('row', 'Row', ['left', 'right']);
  builder.container('card', 'Card', ['row']);
  return 'card';
}

function peoplePicker(contacts: readonly Contact[], chosen: readonly string[], builder: SurfaceBuilder): string {
  if (contacts.length === 0) builder.warnings.push('people_picker: no contacts to pick from');
  builder.leaf({ key: 'title', type: 'Heading', copy: { text: "Who's getting a text?" }, fixed: { level: 1 } });
  builder.leaf({
    key: 'subtitle',
    type: 'Text',
    // The count is the feedback. Saying "Ari" repainted a screen identical to
    // the one before it, so there was no way to tell the device had heard —
    // which reads exactly like the selection doing nothing.
    copy: { text: chosen.length === 0 ? 'Pick up to 3' : `${chosen.length} chosen — say another name, or "send"` },
    fixed: { tone: 'muted' },
  });
  const keys = contacts.map((contact, index) => {
    const key = `person_${index}`;
    const picked = chosen.includes(contact.id);
    builder.leaf({
      key,
      type: 'ListItem',
      // `meta` is the row's own right-hand mark, so a chosen contact is
      // legible at a metre without a component the vocabulary does not have.
      copy: { title: contact.name, ...(picked ? { meta: 'Picked' } : {}) },
      fixed: { interactive: true },
      action: `choose_${contact.id}`,
    });
    return key;
  });
  builder.leaf({
    key: 'confirm',
    type: 'Button',
    copy: { text: chosen.length === 0 ? 'Pick someone first' : `Text ${chosen.length}` },
    fixed: { variant: 'primary' },
    action: 'write_messages',
  });
  builder.container('left', 'Stack', ['title', 'subtitle']);
  // Confirm sits under the names it confirms — it is also what the rail maps
  // to, and a "Send" button ahead of the people is the wrong reading order.
  builder.container('right', 'Stack', [...keys, 'confirm']);
  builder.container('row', 'Row', ['left', 'right']);
  builder.container('card', 'Card', ['row']);
  return 'card';
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

export type ProjectedIds = {
  requestId: string;
  generationId: string;
  maxWidth?: number;
  /** The stage height available to the surface. Defaults to the device panel. */
  maxHeight?: number;
  /**
   * Let the budget DROP rows to fit, rather than only reporting the overflow.
   * Off by default — see `SurfaceBuilder`'s constructor.
   */
  enforceHeight?: boolean;
  /** Wall clock for any timer on the surface. Defaults to now. */
  now?: number;
};

export type ProjectedResult =
  | { ok: true; structure: StructureUpdateV2; content: ContentUpdateV2; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

/**
 * The panel is 800px wide. 640 left a narrow column with dead space either
 * side of it, which is also why every surface read as the same shape.
 */
const DEFAULT_MAX_WIDTH = 760;
/**
 * The stage a 800x480 panel actually leaves a surface, once the shell's rail
 * and utterance bar have taken their rows. Measured on the device rather than
 * derived, and overridable because the panel is the device's business, not
 * this composer's.
 */
const DEFAULT_MAX_HEIGHT = 364;

/**
 * Builds the whole surface — structure AND the content that fills it — from
 * typed task state, synchronously. Never throws; a surface that cannot ship
 * comes back as `ok: false` with the reason, never as a plausible-looking
 * empty screen (CLAUDE.md constraint 5).
 */
/**
 * The GENERATED surfaces: `generic_answer` and `message_drafts`.
 *
 * Structure from a template, content from the model — the other half of the
 * architecture from `composeProjected`, which owns the surfaces the domain
 * fully determines. Nothing here knows what a recipe is; the only thing that
 * makes this surface about anything is the utterance the content model is
 * handed.
 *
 * It returns structure ALONE. Every text slot is bound and pending, so the
 * device paints the skeleton at its final dimensions immediately and the copy
 * fills in when `generate` answers — which is the paint model the whole
 * latency budget is built on, and the reason this is not one blocking call.
 */
export type GeneratedKind = 'generic_answer' | 'message_drafts';

export const isGeneratedSurface = (kind: string): kind is GeneratedKind =>
  kind === 'generic_answer' || kind === 'message_drafts';

export function composeGenerated(kind: GeneratedKind, ids: ProjectedIds): ProjectedResult {
  const builder = new SurfaceBuilder(ids.now, ids.maxHeight ?? DEFAULT_MAX_HEIGHT, ids.enforceHeight ?? false);
  let root: string;
  try {
    root = kind === 'generic_answer' ? genericAnswer(builder) : messageDrafts(builder);
  } catch (err) {
    return { ok: false, reason: `${kind}: ${String(err)}`, warnings: builder.warnings };
  }

  const { spec, values } = builder.build(root);
  const error = validateProjectedSpec(spec, values);
  if (error) return { ok: false, reason: `${kind}: ${error}`, warnings: builder.warnings };

  return {
    ok: true,
    warnings: builder.warnings,
    structure: {
      v: 2, stage: 'structure', status: 'complete', requestId: ids.requestId, generationId: ids.generationId,
      spec, maxWidth: ids.maxWidth ?? DEFAULT_MAX_WIDTH,
    },
    // No content: every slot is pending until the model answers.
    content: { v: 2, stage: 'content', requestId: ids.requestId, generationId: ids.generationId, complete: false, values: {} },
  };
}

/** An answer to something nobody scripted. The judge's unplanned question. */
function genericAnswer(builder: SurfaceBuilder): string {
  builder.leaf({ key: 'kind', type: 'Label', generate: ['text'] });
  builder.leaf({ key: 'title', type: 'Heading', generate: ['text'], fixed: { level: 1 }, lines: 2 });
  builder.leaf({ key: 'body', type: 'Text', generate: ['text'], lines: 3 });
  // Three points, because a surface that sometimes has two and sometimes four
  // cannot reserve its own height. An instance with less to say collapses the
  // spare ones (`ContentPatch` null) rather than leaving them shimmering.
  for (const n of [1, 2, 3]) {
    builder.leaf({ key: `point${n}`, type: 'ListItem', generate: ['title'] });
  }
  builder.leaf({ key: 'action', type: 'Button', generate: ['text'], fixed: { variant: 'primary' }, action: 'acknowledge' });

  builder.container('stack', 'Stack', ['kind', 'title', 'body', 'point1', 'point2', 'point3', 'action']);
  builder.container('card', 'Card', ['stack']);
  return 'card';
}

/** Share the result: a few drafts to pick from. */
function messageDrafts(builder: SurfaceBuilder): string {
  builder.leaf({ key: 'kind', type: 'Label', generate: ['text'] });
  builder.leaf({ key: 'title', type: 'Heading', generate: ['text'], fixed: { level: 1 }, lines: 2 });
  const keys: string[] = [];
  for (const n of [1, 2, 3]) {
    const key = `draft${n}`;
    builder.leaf({ key, type: 'ListItem', generate: ['title', 'detail'], fixed: { hasDetail: true }, action: `pick_draft_${n}` });
    keys.push(key);
  }
  builder.container('stack', 'Stack', ['kind', 'title', ...keys]);
  builder.container('card', 'Card', ['stack']);
  return 'card';
}

export function composeProjected(input: ProjectedInput, ids: ProjectedIds): ProjectedResult {
  const builder = new SurfaceBuilder(ids.now, ids.maxHeight ?? DEFAULT_MAX_HEIGHT, ids.enforceHeight ?? false);
  let root: string;
  try {
    switch (input.kind) {
      case 'item_detail': root = itemDetail(input.state, builder); break;
      case 'focus_step': root = focusStep(input.state, builder); break;
      case 'recovery': root = recovery(input.state, builder); break;
      case 'summary_done': root = summaryDone(input.state, builder); break;
      case 'choice_cards': root = choiceCards(input.options, builder); break;
      case 'people_picker': root = peoplePicker(input.contacts, input.chosen ?? [], builder); break;
      case 'show_me': root = showMe(input, builder); break;
    }
  } catch (err) {
    return { ok: false, reason: `${input.kind}: ${String(err)}`, warnings: builder.warnings };
  }

  const { spec, values } = builder.build(root);

  /**
   * A surface whose mandatory parts exceed the panel cannot be fixed by
   * folding a row — there is nothing optional left to drop. It ships, and it
   * says so: silently handing back a spec that will paint its primary action
   * below the fold is the failure constraint 5 forbids, and the device has no
   * way to discover it on its own.
   */
  const height = estimateSpecHeight(spec);
  const panel = ids.maxHeight ?? DEFAULT_MAX_HEIGHT;
  if (height > panel) {
    builder.warnings.push(
      `${input.kind}: estimated ${Math.round(height)}px against a ${panel}px stage — ` +
        `${Math.round(height - panel)}px will be below the fold`,
    );
  }

  const error = validateProjectedSpec(spec, values);
  if (error) return { ok: false, reason: `${input.kind}: ${error}`, warnings: builder.warnings };

  return {
    ok: true,
    warnings: builder.warnings,
    structure: {
      v: 2,
      stage: 'structure',
      requestId: ids.requestId,
      generationId: ids.generationId,
      maxWidth: ids.maxWidth ?? DEFAULT_MAX_WIDTH,
      status: 'complete',
      spec,
    },
    content: {
      v: 2,
      stage: 'content',
      requestId: ids.requestId,
      generationId: ids.generationId,
      complete: true,
      values,
    },
  };
}

/**
 * The same composition behind the `StructureComposer` seam, so the graph never
 * learns which composer it has.
 *
 * `intent` is ignored: the task state, not the utterance, determines this
 * surface — that is the whole point of projecting it.
 *
 * A failed composition yields `{ kind: 'unavailable' }` rather than throwing.
 * This composer was written against an earlier seam that had no error channel,
 * where throwing was the only alternative to yielding a half-empty spec —
 * the silent fallback constraint 5 forbids. `ComposeEvent` added that channel
 * (it exists so the model composer can report `stopReason: 'unavailable'`
 * instead of ending a turn painting nothing), so reporting is now both
 * possible and uniform across the two composers. Callers that must stay total
 * (`nodes/project.ts`) still use `composeProjected` directly.
 *
 * `inputTokens: 0` is the honest number and the point of this path: no model
 * is consulted, so composition costs nothing and cannot be omitted by one.
 */
export function projectedComposer(input: ProjectedInput, maxWidth?: number): StructureComposerLike {
  return {
    async *compose({ requestId, generationId }, signal) {
      signal.throwIfAborted();
      const startedAt = Date.now();
      const result = composeProjected(input, {
        requestId,
        generationId,
        ...(maxWidth !== undefined ? { maxWidth } : {}),
      });
      const completion = {
        stopReason: result.ok ? ('finish' as const) : ('unavailable' as const),
        inputTokens: 0,
        elapsedMs: Date.now() - startedAt,
        steps: 0,
      };
      if (!result.ok) {
        yield { kind: 'unavailable' as const, reason: result.reason, completion };
        return;
      }
      yield { kind: 'structure' as const, update: result.structure, completion };
    },
  };
}
