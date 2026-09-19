/**
 * The contract. Four independent patches merge into one render; every other
 * package in the repo codes against these types and nothing else.
 *
 * Zero imports, zero runtime dependencies — this file must stay type-only so it
 * can be consumed by the extension's service worker, the Pi kiosk, and the
 * orchestrator without dragging anything along.
 */

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

/**
 * Agent 2 selects one of these by ID. It never emits a tree — the trees live in
 * `@jit/renderer` and are static.
 */
export type TemplateId =
  | 'task_focus'
  | 'ticket_detail'
  | 'auth_form'
  | 'dashboard'
  | 'reader'
  | 'settings_panel'
  | 'confirm_action'
  | 'progress_task';

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

/**
 * Every var the renderer's stylesheet consumes. `resolve()` in `@jit/tokens`
 * must emit all of them; agent 4 may override any subset.
 */
export type CssVar =
  // colour
  | '--jit-bg'
  | '--jit-surface'
  | '--jit-border'
  | '--jit-fg'
  | '--jit-muted'
  | '--jit-accent'
  | '--jit-on-accent'
  | '--jit-accent-soft'
  | '--jit-input'
  // type
  | '--jit-font-display'
  | '--jit-font-body'
  | '--jit-weight-display'
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
  | 'Alert';

/** The finite set. 20 components; growing it is a design decision, not a patch. */
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
  | { kind: 'ListItem'; title: string; meta?: string }
  | { kind: 'Bars'; values: number[] }
  | { kind: 'Rule'; left: string; right?: string }
  | { kind: 'Button'; text: string }
  | { kind: 'TextField'; label: string; placeholder?: string; value?: string }
  | { kind: 'Toggle'; label: string; on: boolean }
  | { kind: 'Progress'; pct: number }
  | { kind: 'Alert'; text: string };

/**
 * Every slot in every template, bound to the one component kind that may fill
 * it. Slot IDs are template-prefixed and therefore globally unique, so this
 * single flat map is enough to make a mismatched content patch a compile error.
 */
export interface SlotKindMap {
  // task_focus — a single action stripped to its controls
  'task_focus.badge': 'Badge';
  'task_focus.title': 'Heading';
  'task_focus.preview': 'Media';
  'task_focus.range': 'Rule';
  'task_focus.markIn': 'Button';
  'task_focus.markOut': 'Button';
  'task_focus.confirm': 'Button';

  // ticket_detail — one record, shown whole
  'ticket_detail.operator': 'Label';
  'ticket_detail.title': 'Heading';
  'ticket_detail.summary': 'Text';
  'ticket_detail.origin': 'Metric';
  'ticket_detail.destination': 'Metric';
  'ticket_detail.seat': 'Rule';
  'ticket_detail.view': 'Button';

  // auth_form
  'auth_form.title': 'Heading';
  'auth_form.subtitle': 'Text';
  'auth_form.email': 'TextField';
  'auth_form.password': 'TextField';
  'auth_form.submit': 'Button';
  'auth_form.recover': 'Button';

  // dashboard — the densest template
  'dashboard.title': 'Heading';
  'dashboard.period': 'Text';
  'dashboard.primaryMetric': 'Metric';
  'dashboard.secondaryMetric': 'Metric';
  'dashboard.tertiaryMetric': 'Metric';
  'dashboard.chartLabel': 'Label';
  'dashboard.chart': 'Bars';
  'dashboard.listLabel': 'Label';
  'dashboard.item1': 'ListItem';
  'dashboard.item2': 'ListItem';
  'dashboard.item3': 'ListItem';

  // reader — the only template with no Card and no controls
  'reader.title': 'Heading';
  'reader.byline': 'Text';
  'reader.para1': 'Text';
  'reader.para2': 'Text';
  'reader.para3': 'Text';

  // settings_panel — four toggles, one per physical button
  'settings_panel.title': 'Heading';
  'settings_panel.option1': 'Toggle';
  'settings_panel.option2': 'Toggle';
  'settings_panel.option3': 'Toggle';
  'settings_panel.option4': 'Toggle';

  // confirm_action
  'confirm_action.title': 'Heading';
  'confirm_action.warning': 'Alert';
  'confirm_action.cancel': 'Button';
  'confirm_action.confirm': 'Button';

  // progress_task
  'progress_task.status': 'Label';
  'progress_task.title': 'Heading';
  'progress_task.progress': 'Progress';
  'progress_task.detail': 'Rule';
  'progress_task.cancel': 'Button';
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
 * Agent 1. Partial by design: slots arrive as they are extracted, and any slot
 * still unfilled renders as a shimmer at its final dimensions.
 */
export type ContentPatch = {
  v: 1;
  slots: Partial<{ [S in SlotId]: SlotValueFor<S> }>;
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

/** What pressing a physical button mapped to this action actually does. */
export type ActionKind = 'press' | 'toggle' | 'text';

export type ActionDescriptor = {
  /** Position in DOM order. Stable across content arrival. */
  index: number;
  action: string;
  kind: ActionKind;
  slot: SlotId;
  /**
   * Null until the content patch lands. The hardware needs the mapping at
   * skeleton paint, which is before any label exists.
   */
  label: string | null;
};

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

/**
 * `*-on-surface` exists because most templates render inside a Card, so their
 * text sits on `--jit-surface` rather than `--jit-bg`. Checking only against bg
 * rejects token sets that are perfectly readable where they are actually drawn.
 */
export type ContrastPair =
  | 'fg-on-bg'
  | 'muted-on-bg'
  | 'fg-on-surface'
  | 'muted-on-surface'
  | 'on-accent-on-accent';

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

/** Which grounds a template actually draws text on. Narrows the required pairs. */
export type Surface = 'bg' | 'surface';
