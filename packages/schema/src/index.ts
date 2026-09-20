/**
 * The contract. Four independent patches merge into one render; every other
 * package in the repo codes against these types and nothing else.
 *
 * Zero imports, zero runtime dependencies — this file must stay type-only so it
 * can be consumed by the kiosk, the orchestrator and the GPIO bridge without
 * dragging anything along.
 */

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

/**
 * Agent 2 selects one of these by ID. It never emits a tree — the trees live in
 * `@jit/renderer` and are static. A model that could generate structure could
 * generate structure we have no CSS for.
 *
 * The set is shaped by the phases of a task, not by any one domain:
 * decide → review → act → recover → finish → pick → compose → answer.
 */
export type TemplateId =
  /** Choose between generated options. A slider scrubs the axis they vary on. */
  | 'choice_cards'
  /** The chosen thing, whole, with the quantities a slider can rescale. */
  | 'item_detail'
  /** One instruction at a time. Deliberately sparse; the encoder scrubs steps. */
  | 'focus_step'
  /** Something went wrong: diagnosis, recommended fix, consequence. */
  | 'recovery'
  /** The task is done. An open prompt, not a button row. */
  | 'summary_done'
  /** Pick people. */
  | 'people_picker'
  /** Generated drafts, one per recipient, with a tone axis. */
  | 'message_drafts'
  /**
   * Anything unscripted. This is what answers a judge driving the device, so it
   * is demo-critical rather than a safety net.
   */
  | 'generic_answer';

/* ------------------------------------------------------------------ *
 * Style axes — agent 3 (Jev) picks one value per axis, nothing else
 * ------------------------------------------------------------------ */

export type Palette = 'slate' | 'mono' | 'rose' | 'contrast';
export type FontPairing = 'system' | 'editorial' | 'geometric' | 'mono';
export type Density = 'compact' | 'normal' | 'spacious';
export type Radius = 'sharp' | 'soft' | 'round';
export type Motif = 'none' | 'floral' | 'geometric';

export type ThemeEnums = {
  palette: Palette;
  fontPairing: FontPairing;
  density: Density;
  radius: Radius;
  motif: Motif;
};

/* ------------------------------------------------------------------ *
 * CSS custom properties — the full surface the renderer reads
 * ------------------------------------------------------------------ */

export type CssVar =
  // colour
  | '--jit-bg'
  | '--jit-surface'
  | '--jit-border'
  | '--jit-fg'
  | '--jit-muted'
  | '--jit-accent'
  /** Gradient partner for `--jit-accent`; a neighbour in hue, not a second brand. */
  | '--jit-accent-2'
  /** End stop of the ramp. Gradients only; never a flat fill. */
  | '--jit-accent-3'
  | '--jit-on-accent'
  | '--jit-accent-soft'
  | '--jit-input'
  // type
  | '--jit-font-display'
  | '--jit-font-body'
  | '--jit-weight-display'
  | '--jit-tracking-display'
  | '--jit-scale'
  // space
  | '--jit-gap'
  | '--jit-pad'
  | '--jit-density-f'
  // shape
  | '--jit-radius'
  | '--jit-radius-sm'
  // decoration + extent
  | '--jit-motif'
  | '--jit-maxw';

export type TokenSet = Record<CssVar, string>;

/* ------------------------------------------------------------------ *
 * Component vocabulary
 * ------------------------------------------------------------------ */

/** Structural components. They compose children and never take a slot. */
export type StructuralComponent = 'Stack' | 'Row' | 'Grid' | 'Card' | 'Divider' | 'ButtonGroup';

/** Leaf components. Each consumes exactly one slot. */
export type LeafComponent =
  | 'Heading'
  | 'Text'
  | 'Label'
  | 'Metric'
  | 'Media'
  | 'Badge'
  | 'ListItem'
  | 'Bars'
  | 'Rule'
  | 'Button'
  | 'TextField'
  | 'Toggle'
  | 'Progress'
  | 'Alert'
  | 'Slider';

/** The finite set. Growing it is a design decision, not a patch. */
export type ComponentType = StructuralComponent | LeafComponent;

/* ------------------------------------------------------------------ *
 * Slot values — discriminated by the component that consumes them
 * ------------------------------------------------------------------ */

export type SlotValue =
  | { kind: 'Heading'; text: string }
  | { kind: 'Text'; text: string }
  | { kind: 'Label'; text: string }
  | { kind: 'Metric'; label: string; value: string; delta?: string }
  | { kind: 'Media'; caption?: string; src?: string }
  | { kind: 'Badge'; text: string }
  /** `detail` is the secondary line; `meta` is the trailing value (a price, a time). */
  | { kind: 'ListItem'; title: string; detail?: string; meta?: string }
  | { kind: 'Bars'; values: number[] }
  | { kind: 'Rule'; left: string; right?: string }
  | { kind: 'Button'; text: string }
  | { kind: 'TextField'; label: string; placeholder?: string; value?: string }
  | { kind: 'Toggle'; label: string; on: boolean }
  | { kind: 'Progress'; pct: number }
  | { kind: 'Alert'; text: string }
  /**
   * A continuous control. Its label and range are generated, which is what lets
   * one physical fader mean recipe preference, then batch size, then message
   * tone. `minLabel`/`maxLabel` name the poles ("Quick" / "Impressive").
   */
  | {
      kind: 'Slider';
      label: string;
      min: number;
      max: number;
      step: number;
      value: number;
      unit?: string;
      minLabel?: string;
      maxLabel?: string;
    };

/**
 * Every slot in every template, bound to the one component kind that may fill
 * it. Slot IDs are template-prefixed and therefore globally unique, so this
 * single flat map is enough to make a mismatched content patch a compile error.
 */
export interface SlotKindMap {
  // choice_cards — decide between generated options
  'choice_cards.title': 'Heading';
  'choice_cards.subtitle': 'Text';
  'choice_cards.axis': 'Slider';
  'choice_cards.option1': 'ListItem';
  'choice_cards.option2': 'ListItem';
  'choice_cards.option3': 'ListItem';

  // item_detail — the chosen thing, whole
  'item_detail.title': 'Heading';
  'item_detail.subtitle': 'Text';
  'item_detail.axis': 'Slider';
  'item_detail.linesLabel': 'Label';
  'item_detail.line1': 'ListItem';
  'item_detail.line2': 'ListItem';
  'item_detail.line3': 'ListItem';
  'item_detail.line4': 'ListItem';
  'item_detail.line5': 'ListItem';
  'item_detail.line6': 'ListItem';
  'item_detail.line7': 'ListItem';
  'item_detail.line8': 'ListItem';
  'item_detail.primary': 'Button';

  // focus_step — one instruction at a time
  'focus_step.progress': 'Label';
  'focus_step.instruction': 'Heading';
  'focus_step.detail1': 'ListItem';
  'focus_step.detail2': 'ListItem';
  'focus_step.detail3': 'ListItem';
  'focus_step.prev': 'Button';
  'focus_step.next': 'Button';
  'focus_step.done': 'Button';

  // recovery — the reasoning moment
  'recovery.kind': 'Label';
  'recovery.title': 'Heading';
  'recovery.diagnosis': 'Alert';
  'recovery.planLabel': 'Label';
  'recovery.plan': 'Text';
  'recovery.outcome': 'Metric';
  'recovery.secondary': 'Button';
  'recovery.primary': 'Button';

  // summary_done — deliberately actionless; the device waits for you
  'summary_done.title': 'Heading';
  'summary_done.result': 'Metric';
  'summary_done.prompt': 'Text';

  // people_picker
  'people_picker.title': 'Heading';
  'people_picker.subtitle': 'Text';
  'people_picker.person1': 'ListItem';
  'people_picker.person2': 'ListItem';
  'people_picker.person3': 'ListItem';
  'people_picker.confirm': 'Button';

  // message_drafts — crossing out of the original domain
  'message_drafts.title': 'Heading';
  'message_drafts.tone': 'Slider';
  'message_drafts.name1': 'Label';
  'message_drafts.body1': 'Text';
  'message_drafts.name2': 'Label';
  'message_drafts.body2': 'Text';
  'message_drafts.edit': 'Button';
  'message_drafts.send': 'Button';

  // generic_answer — the judge handoff
  'generic_answer.title': 'Heading';
  'generic_answer.body': 'Text';
  'generic_answer.point1': 'ListItem';
  'generic_answer.point2': 'ListItem';
  'generic_answer.point3': 'ListItem';
  'generic_answer.action': 'Button';
}

export type SlotId = keyof SlotKindMap;

/** The one `SlotValue` variant a given slot will accept. */
export type SlotValueFor<S extends SlotId> = Extract<SlotValue, { kind: SlotKindMap[S] }>;

/** The slots belonging to one template, derived from the ID prefix. */
export type SlotsOf<T extends TemplateId> = Extract<SlotId, `${T}.${string}`>;

/* ------------------------------------------------------------------ *
 * The four patches
 * ------------------------------------------------------------------ */

/** Agent 2. Structure only — paints first, unblocks everything else. */
export type SkeletonPatch = {
  v: 1;
  templateId: TemplateId;
  maxWidth: number;
};

/**
 * Agent 1.
 *
 * Partial by design: slots arrive as they are produced, and any slot still
 * unfilled renders as a shimmer at its final dimensions.
 *
 * An explicit `null` means **not applicable to this instance** — a recipe with
 * six ingredients in a template that reserves eight. The renderer collapses
 * those rather than shimmering forever on a slot that will never fill.
 * `undefined` (absent) still means "pending". Distinguishing the two is what
 * lets one fixed template serve variable-length content, which the judge
 * handoff requires.
 */
export type ContentPatch = {
  v: 1;
  slots: Partial<{ [S in SlotId]: SlotValueFor<S> | null }>;
};

/** Agent 3 (Jev). Enum selections only — no value here is ever a hex code. */
export type StylePatch = {
  v: 1;
  theme: ThemeEnums;
};

/**
 * Agent 4. Raw, novel tokens that no table contains. Partial because a polish
 * pass overrides the axes it cares about and leaves the rest to the enum base.
 */
export type PolishPatch = {
  v: 1;
  tokens: Partial<TokenSet>;
  /** What agent 4 understood the request to mean. Shown in telemetry. */
  interpretedAs: string;
};

export type Patch = SkeletonPatch | ContentPatch | StylePatch | PolishPatch;

/* ------------------------------------------------------------------ *
 * Actions — the hardware layer's view of the surface
 * ------------------------------------------------------------------ */

export type ActionKind = 'press' | 'toggle' | 'text' | 'range';

type ActionBase = {
  /** Position in DOM order. Stable from skeleton paint onward. */
  index: number;
  action: string;
  slot: SlotId;
  /**
   * Null until the content patch lands. The hardware needs the mapping at
   * skeleton paint, which is before any label exists.
   */
  label: string | null;
};

export type PressAction = ActionBase & { kind: 'press' };
export type TextAction = ActionBase & { kind: 'text' };
export type ToggleAction = ActionBase & { kind: 'toggle'; on: boolean | null };

/**
 * A continuous control. `range` is null until content lands, for the same
 * reason `label` is: the descriptor exists at skeleton paint, but nothing has
 * told us yet what the axis means.
 */
export type RangeAction = ActionBase & {
  kind: 'range';
  range: {
    min: number;
    max: number;
    step: number;
    value: number;
    unit: string | null;
    minLabel: string | null;
    maxLabel: string | null;
  } | null;
};

export type ActionDescriptor = PressAction | TextAction | ToggleAction | RangeAction;

/**
 * The device has four buttons and one fader. A surface that exceeds either is a
 * surface the hardware cannot express, so both are asserted in the renderer's
 * tests rather than left to review.
 */
export const BUTTON_COUNT = 4;
export const RANGE_CONTROL_COUNT = 1;

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

/**
 * `*-on-surface` exists because most templates render inside a Card, so their
 * text sits on `--jit-surface` rather than `--jit-bg`. Checking only against bg
 * rejects token sets that are perfectly readable where they are actually drawn.
 *
 * `fg-on-accent-soft` exists because `Badge` and `Alert` paint on
 * `--jit-accent-soft`, not `bg` or `surface`. Required via `Surface`'s
 * `accent-soft`, opt-in the same way `surface` is.
 *
 * There is deliberately no `accent-on-accent-soft`. Badge's text used to be
 * `--jit-accent` on this background, and for `slate` that measured 3.63:1 —
 * nowhere near the 4.5:1 floor. Darkening `accentSoft` cannot fix this: with
 * `slate`'s actual accent hue, the ceiling even at pure black is 4.512:1, a
 * fragile pass that would also flatten the tinted badge to solid black. The
 * real fix was in the renderer, not the palette — Badge's text now uses `fg`,
 * which clears AA by a wide margin (13.6–17.6:1) on every palette. Checking a
 * pairing nothing renders would only force future palettes to satisfy a
 * constraint their accent hue may make impossible.
 */
export type ContrastPair =
  | 'fg-on-bg'
  | 'muted-on-bg'
  | 'fg-on-surface'
  | 'muted-on-surface'
  | 'on-accent-on-accent'
  | 'fg-on-accent-soft';

export type ContrastCheck = {
  pair: ContrastPair;
  /** Null when a colour could not be parsed — which counts as a failure. */
  ratio: number | null;
  required: number;
  pass: boolean;
  /** Present only on failure. Says why, so telemetry is actionable. */
  reason?: string;
};

export type ContrastReport = {
  pass: boolean;
  checks: ContrastCheck[];
};

/**
 * Which grounds a template actually draws text on. Narrows the required pairs.
 *
 * `accent-soft` is a component ground, not a page ground: it's opt-in, the same
 * way `surface` is, and a template must declare it if and only if its tree
 * contains a `Badge` or an `Alert` — enforced in the renderer's template tests,
 * not left to memory.
 */
export type Surface = 'bg' | 'surface' | 'accent-soft';
