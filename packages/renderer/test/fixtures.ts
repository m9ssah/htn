import type { ContentPatch, SlotId, SlotValue, TemplateId } from '@jit/schema';
import { TEMPLATES, isLeaf, type Template, type TemplateNode } from '@jit/renderer';

/**
 * Builds a complete content patch for a template by walking its tree, so every
 * test covers every slot of all eight templates without 50 hand-written values
 * drifting out of sync with the templates themselves.
 */
const VALUE_FOR: { [K in SlotValue['kind']]: (slot: string) => Extract<SlotValue, { kind: K }> } = {
  Heading: (s) => ({ kind: 'Heading', text: `Heading ${s}` }),
  Text: (s) => ({ kind: 'Text', text: `Text ${s}` }),
  Label: (s) => ({ kind: 'Label', text: `Label ${s}` }),
  Metric: (s) => ({ kind: 'Metric', label: `Label ${s}`, value: '48,250', delta: '+4.6%' }),
  Media: (s) => ({ kind: 'Media', caption: `Media ${s}` }),
  Badge: (s) => ({ kind: 'Badge', text: `Badge ${s}` }),
  ListItem: (s) => ({ kind: 'ListItem', title: `Item ${s}`, detail: 'detail', meta: '$6.40' }),
  Bars: () => ({ kind: 'Bars', values: [52, 38, 78, 60] }),
  Rule: (s) => ({ kind: 'Rule', left: `Left ${s}`, right: 'Right' }),
  Button: (s) => ({ kind: 'Button', text: `Press ${s}` }),
  TextField: (s) => ({ kind: 'TextField', label: `Field ${s}`, placeholder: 'type here' }),
  Toggle: (s) => ({ kind: 'Toggle', label: `Option ${s}`, on: true }),
  Progress: () => ({ kind: 'Progress', pct: 68 }),
  Alert: (s) => ({ kind: 'Alert', text: `Alert ${s}` }),
  Slider: (s) => ({
    kind: 'Slider',
    label: `Axis ${s}`,
    min: 0,
    max: 10,
    step: 1,
    value: 4,
    unit: 'x',
    minLabel: 'Low',
    maxLabel: 'High',
  }),
};

export function slotsOf(template: Template): { slot: SlotId; kind: SlotValue['kind'] }[] {
  const out: { slot: SlotId; kind: SlotValue['kind'] }[] = [];
  const walk = (node: TemplateNode): void => {
    if (isLeaf(node)) {
      out.push({ slot: node.slot, kind: node.type });
      return;
    }
    if (node.type === 'Divider') return;
    for (const child of node.children) walk(child);
  };
  walk(template.tree);
  return out;
}

export function fullContent(templateId: TemplateId): ContentPatch {
  const slots: Record<string, SlotValue> = {};
  for (const { slot, kind } of slotsOf(TEMPLATES[templateId])) {
    slots[slot] = VALUE_FOR[kind](slot);
  }
  return { v: 1, slots } as ContentPatch;
}

/** Canonical serialisation: structure plus the custom properties, order-free. */
export function canonical(root: HTMLElement): string {
  const props: string[] = [];
  for (let i = 0; i < root.style.length; i += 1) {
    const name = root.style.item(i);
    if (name.startsWith('--')) props.push(`${name}: ${root.style.getPropertyValue(name)}`);
  }
  props.sort();
  return `${props.join('\n')}\n----\n${root.innerHTML}`;
}

/** All orderings of n items. */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}
