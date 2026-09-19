import type { ActionKind, LeafComponent, SlotValue } from '@jit/schema';

/**
 * The 20-component vocabulary, as behaviour.
 *
 * Adding to this set is a design decision, not a patch — the finite space is
 * what lets agent 2 select a template instead of generating a tree.
 *
 * Every leaf builds its full internal structure once. Filling a slot only ever
 * writes text into nodes that already exist, so content landing cannot replace
 * a node, and a slot that never fills keeps the box it reserved.
 */

export type HeadingLevel = 1 | 2 | 3;
export type TextTone = 'default' | 'muted';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type NodeProps = {
  level?: HeadingLevel;
  tone?: TextTone;
  variant?: ButtonVariant;
};

/** How many placeholder bars a Bars slot reserves before real values arrive. */
const PLACEHOLDER_BAR_HEIGHTS = [42, 66, 34, 78, 52];

const el = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

type Filler = (root: HTMLElement, value: SlotValue | undefined) => void;

export type LeafSpec = {
  /**
   * The kind of action this component produces IF the template gives it one.
   * Null means the component can never be a control.
   */
  actionKind: ActionKind | null;
  /**
   * True when omitting an action string is a bug rather than a choice. A Button
   * with no action is unreachable; a ListItem with no action is just a row.
   */
  actionRequired: boolean;
  build: (props: NodeProps) => HTMLElement;
  fill: Filler;
  /** Text shown on a physical-button label, once content exists. */
  labelOf: (value: SlotValue) => string | null;
};

/** Sets or clears the shimmer state without touching structure. */
const shimmer = (root: HTMLElement, on: boolean): void => {
  if (on) root.setAttribute('data-shimmer', '');
  else root.removeAttribute('data-shimmer');
};

const text = (root: HTMLElement, selector: string, value: string): void => {
  const target = root.querySelector<HTMLElement>(selector);
  if (target) target.textContent = value;
};

export const LEAVES: Record<LeafComponent, LeafSpec> = {
  Heading: {
    actionKind: null,
    actionRequired: false,
    build: (props) => {
      const level: HeadingLevel = props.level ?? 2;
      const node = el(`h${level}`, 'c-heading');
      node.dataset['level'] = String(level);
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Heading' ? value.text : '';
    },
    labelOf: () => null,
  },

  Text: {
    actionKind: null,
    actionRequired: false,
    build: (props) => {
      const node = el('p', 'c-text');
      node.dataset['tone'] = props.tone ?? 'default';
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Text' ? value.text : '';
    },
    labelOf: () => null,
  },

  Label: {
    actionKind: null,
    actionRequired: false,
    build: () => el('span', 'c-label'),
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Label' ? value.text : '';
    },
    labelOf: () => null,
  },

  Metric: {
    actionKind: null,
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-metric');
      node.append(el('span', 'c-label'), el('div', 'm-value'), el('div', 'm-delta'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'Metric' ? value : undefined;
      text(root, '.c-label', v?.label ?? '');
      text(root, '.m-value', v?.value ?? '');
      text(root, '.m-delta', v?.delta ?? '');
    },
    labelOf: () => null,
  },

  Media: {
    actionKind: null,
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-media');
      node.append(el('span', 'm-caption'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'Media' ? value : undefined;
      text(root, '.m-caption', v?.caption ?? '');
      if (v?.src) root.style.setProperty('background-image', `url("${v.src}")`);
      else root.style.removeProperty('background-image');
    },
    labelOf: () => null,
  },

  Badge: {
    actionKind: null,
    actionRequired: false,
    build: () => el('span', 'c-badge'),
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Badge' ? value.text : '';
    },
    labelOf: () => null,
  },

  ListItem: {
    // Selectable only when a template gives it an action — a recipe option or a
    // person is a control; an ingredient row is not.
    actionKind: 'press',
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-listitem');
      const main = el('span', 'li-main');
      main.append(el('span', 'li-title'), el('span', 'li-detail'));
      node.append(main, el('span', 'li-meta'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'ListItem' ? value : undefined;
      text(root, '.li-title', v?.title ?? '');
      text(root, '.li-detail', v?.detail ?? '');
      text(root, '.li-meta', v?.meta ?? '');
      // hasDetail is a template reservation set at build time — content fills
      // the line, it does not get to decide whether the line exists.
    },
    labelOf: (value) => (value.kind === 'ListItem' ? value.title : null),
  },

  Bars: {
    actionKind: null,
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-bars');
      for (const height of PLACEHOLDER_BAR_HEIGHTS) {
        const bar = el('i', 'b-bar');
        bar.style.setProperty('height', `${height}%`);
        node.append(bar);
      }
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      if (value?.kind !== 'Bars') return;
      // The container's height is fixed in CSS, so swapping the bar count
      // repaints without moving anything below it.
      root.replaceChildren(
        ...value.values.map((height) => {
          const bar = el('i', 'b-bar');
          bar.style.setProperty('height', `${Math.max(0, Math.min(100, height))}%`);
          return bar;
        }),
      );
    },
    labelOf: () => null,
  },

  Rule: {
    actionKind: null,
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-rule');
      node.append(el('span', 'r-left'), el('span', 'r-right'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'Rule' ? value : undefined;
      text(root, '.r-left', v?.left ?? '');
      text(root, '.r-right', v?.right ?? '');
    },
    labelOf: () => null,
  },

  Alert: {
    actionKind: null,
    actionRequired: false,
    build: () => el('div', 'c-alert'),
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Alert' ? value.text : '';
    },
    labelOf: () => null,
  },

  Progress: {
    actionKind: null,
    actionRequired: false,
    build: () => {
      const node = el('div', 'c-progress');
      node.append(el('i', 'p-fill'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const pct = value?.kind === 'Progress' ? Math.max(0, Math.min(100, value.pct)) : 0;
      root.querySelector<HTMLElement>('.p-fill')?.style.setProperty('width', `${pct}%`);
      root.setAttribute('aria-valuenow', String(pct));
    },
    labelOf: () => null,
  },

  Button: {
    actionKind: 'press',
    actionRequired: true,
    build: (props) => {
      const node = el('button', 'c-btn');
      node.setAttribute('type', 'button');
      node.dataset['variant'] = props.variant ?? 'primary';
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      root.textContent = value?.kind === 'Button' ? value.text : '';
    },
    labelOf: (value) => (value.kind === 'Button' ? value.text : null),
  },

  TextField: {
    actionKind: 'text',
    actionRequired: true,
    build: () => {
      const node = el('div', 'c-field');
      const input = document.createElement('input');
      input.className = 'f-input';
      input.setAttribute('type', 'text');
      node.append(el('span', 'c-label'), input);
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'TextField' ? value : undefined;
      text(root, '.c-label', v?.label ?? '');
      const input = root.querySelector<HTMLInputElement>('.f-input');
      if (input) {
        input.placeholder = v?.placeholder ?? '';
        input.value = v?.value ?? '';
      }
    },
    labelOf: (value) => (value.kind === 'TextField' ? value.label : null),
  },

  /**
   * The 21st component. Its label and range come from the patch, which is what
   * lets one physical fader mean recipe preference, then batch size, then
   * message tone.
   */
  Slider: {
    actionKind: 'range',
    actionRequired: true,
    build: () => {
      const node = el('div', 'c-slider');
      const head = el('div', 's-head');
      head.append(el('span', 'c-label'), el('span', 's-value'));
      const input = document.createElement('input');
      input.className = 's-input';
      input.setAttribute('type', 'range');
      const poles = el('div', 's-poles');
      poles.append(el('span', 's-min'), el('span', 's-max'));
      node.append(head, input, poles);
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'Slider' ? value : undefined;
      text(root, '.c-label', v?.label ?? '');
      // A number is only worth showing when it has a unit: "30 cookies" means
      // something, "1" on a Quick-to-Impressive axis does not — the poles
      // already say what that end is. Hidden rather than removed, so the head
      // keeps its reserved height either way.
      text(root, '.s-value', v?.unit ? `${v.value} ${v.unit}` : '');
      text(root, '.s-min', v?.minLabel ?? '');
      text(root, '.s-max', v?.maxLabel ?? '');
      const input = root.querySelector<HTMLInputElement>('.s-input');
      if (input && v) {
        input.min = String(v.min);
        input.max = String(v.max);
        input.step = String(v.step);
        input.value = String(v.value);
      }
      root.dataset['hasPoles'] = v?.minLabel || v?.maxLabel ? 'true' : 'false';
    },
    labelOf: (value) => (value.kind === 'Slider' ? value.label : null),
  },

  Toggle: {
    actionKind: 'toggle',
    actionRequired: true,
    build: () => {
      const node = el('div', 'c-toggle');
      node.setAttribute('role', 'switch');
      node.append(el('span', 't-label'), el('span', 't-switch'));
      return node;
    },
    fill: (root, value) => {
      shimmer(root, value === undefined);
      const v = value?.kind === 'Toggle' ? value : undefined;
      text(root, '.t-label', v?.label ?? '');
      root.dataset['on'] = v?.on ? 'true' : 'false';
      root.setAttribute('aria-checked', v?.on ? 'true' : 'false');
    },
    labelOf: (value) => (value.kind === 'Toggle' ? value.label : null),
  },
};

/** Structural components: they compose children and consume no slot. */
export const STRUCTURAL_CLASS = {
  Stack: 'c-stack',
  Row: 'c-row',
  Grid: 'c-grid',
  Card: 'c-card',
  Divider: 'c-divider',
  ButtonGroup: 'c-btngroup',
} as const;
