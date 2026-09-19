import type { ActionDescriptor, SlotId, SlotValue } from '@jit/schema';
import { LEAVES } from './vocab.js';
import { isLeaf, type Template, type TemplateNode } from './templates.js';

/**
 * Walks a template in DOM order and returns one descriptor per control.
 *
 * Derived from the tree, never from content, so the ordering is stable from the
 * moment the skeleton lands. The hardware layer maps physical controls off this
 * and never inspects the DOM; a mapping that reshuffled when content arrived
 * would move a control out from under someone's finger.
 *
 * Value-carrying fields (`label`, `on`, `range`) are null until content lands.
 * The descriptor exists before then because the hardware needs the mapping at
 * skeleton paint.
 */
export function collectActions(
  template: Template,
  content: Partial<Record<SlotId, SlotValue | null>>,
): ActionDescriptor[] {
  const out: ActionDescriptor[] = [];

  const walk = (node: TemplateNode): void => {
    if (isLeaf(node)) {
      const spec = LEAVES[node.type];

      if (node.action === undefined) {
        if (spec.actionRequired) {
          throw new Error(
            `${node.type} at slot ${node.slot} has no action string. A ${node.type} ` +
              'is unreachable without one, so the hardware could never map it.',
          );
        }
        return;
      }
      if (spec.actionKind === null) {
        throw new Error(
          `${node.type} at slot ${node.slot} was given the action "${node.action}", ` +
            'but this component can never be a control.',
        );
      }

      // A slot explicitly cleared to null is not applicable to this instance,
      // so it is not a control either.
      const value = content[node.slot] ?? undefined;
      const index = out.length;
      const label = value ? spec.labelOf(value) : null;

      switch (spec.actionKind) {
        case 'range':
          out.push({
            index,
            action: node.action,
            slot: node.slot,
            label,
            kind: 'range',
            range:
              value?.kind === 'Slider'
                ? {
                    min: value.min,
                    max: value.max,
                    step: value.step,
                    value: value.value,
                    unit: value.unit ?? null,
                    minLabel: value.minLabel ?? null,
                    maxLabel: value.maxLabel ?? null,
                  }
                : null,
          });
          break;
        case 'toggle':
          out.push({
            index,
            action: node.action,
            slot: node.slot,
            label,
            kind: 'toggle',
            on: value?.kind === 'Toggle' ? value.on : null,
          });
          break;
        case 'text':
          out.push({ index, action: node.action, slot: node.slot, label, kind: 'text' });
          break;
        case 'press':
          out.push({ index, action: node.action, slot: node.slot, label, kind: 'press' });
          break;
      }
      return;
    }

    if (node.type === 'Divider') return;
    for (const child of node.children) walk(child);
  };

  walk(template.tree);
  return out;
}
