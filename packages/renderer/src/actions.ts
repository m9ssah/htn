import type { ActionDescriptor, SlotId, SlotValue } from '@jit/schema';
import { LEAVES } from './vocab.js';
import { isLeaf, type Template, type TemplateNode } from './templates.js';

/**
 * Walks a template in DOM order and returns one descriptor per interactive leaf.
 *
 * Derived from the tree, never from content, so the ordering is stable from the
 * moment the skeleton lands. The hardware layer maps physical buttons off this,
 * and a mapping that reshuffled when content arrived would move a control out
 * from under someone's finger.
 */
export function collectActions(
  template: Template,
  content: Partial<Record<SlotId, SlotValue>>,
): ActionDescriptor[] {
  const out: ActionDescriptor[] = [];

  const walk = (node: TemplateNode): void => {
    if (isLeaf(node)) {
      const spec = LEAVES[node.type];
      if (spec.actionKind === null) return;
      if (node.action === undefined) {
        throw new Error(
          `Interactive leaf ${node.type} at slot ${node.slot} has no action string. ` +
            'Every interactive component must carry one or the hardware cannot map it.',
        );
      }
      const value = content[node.slot];
      out.push({
        index: out.length,
        action: node.action,
        kind: spec.actionKind,
        slot: node.slot,
        label: value ? spec.labelOf(value) : null,
      });
      return;
    }
    if (node.type === 'Divider') return;
    for (const child of node.children) walk(child);
  };

  walk(template.tree);
  return out;
}
