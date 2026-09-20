import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_IDS, isLeaf, type TemplateNode } from '@jit/renderer';

/** Component types that render on `--jit-accent-soft`, not `bg` or `surface`. */
const ACCENT_SOFT_COMPONENTS = new Set(['Badge', 'Alert']);

function usesAccentSoft(node: TemplateNode): boolean {
  if (isLeaf(node)) return ACCENT_SOFT_COMPONENTS.has(node.type);
  if (node.type === 'Divider') return false;
  return node.children.some(usesAccentSoft);
}

describe('template contrast surfaces', () => {
  // A template with a Badge or an Alert paints on --jit-accent-soft. If it
  // doesn't declare that in `surfaces`, checkContrast never validates that
  // ground for this template, and an unreadable badge or alert can ship
  // unnoticed — this is exactly the gap that let slate's Badge fail AA. This
  // test makes forgetting the declaration impossible to merge, rather than
  // relying on whoever adds the next template to remember it.
  it('declares the accent-soft surface whenever the tree contains a Badge or an Alert', () => {
    for (const id of TEMPLATE_IDS) {
      const template = TEMPLATES[id];
      if (usesAccentSoft(template.tree)) {
        expect(template.surfaces, id).toContain('accent-soft');
      }
    }
  });
});
