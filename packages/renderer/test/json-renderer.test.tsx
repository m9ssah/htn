import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, JIT_REGISTRY, createJsonRenderer } from '@jit/renderer';

describe('json-render surface renderer', () => {
  it('registers every design-system primitive in the generated catalog', () => {
    expect(Object.keys(JIT_REGISTRY).sort()).toEqual([
      'Alert', 'Badge', 'Bars', 'Button', 'ButtonGroup', 'Card', 'Divider',
      'Grid', 'Heading', 'Label', 'ListItem', 'Media', 'Metric', 'Progress',
      'Row', 'Rule', 'Slider', 'Stack', 'Text', 'TextField', 'Toggle',
    ]);
  });

  it('converges when content arrives before structure and keeps hardware action order', () => {
    const host = document.createElement('div');
    const example = EXAMPLES[0]!;
    const renderer = createJsonRenderer(host);

    flushSync(() => {
      expect(renderer.apply(example.content)).toEqual({ ok: true });
      expect(renderer.apply(example.style)).toEqual({ ok: true });
      expect(renderer.apply(example.structure)).toEqual({ ok: true });
    });

    expect(host.querySelector('[data-slot="title"]')?.textContent).toBe('Chocolate chip, tonight');
    expect(renderer.getActions().map((action) => action.action)).toEqual(['set_preference', 'select_1', 'select_2', 'select_3']);
    renderer.destroy();
  });

  it('derives accent-soft contrast requirements from the actual spec', () => {
    const host = document.createElement('div');
    const recovery = EXAMPLES.find((example) => example.id === 'recovery')!;
    const renderer = createJsonRenderer(host);
    flushSync(() => {
      renderer.apply(recovery.structure);
      renderer.apply(recovery.style);
      renderer.apply(recovery.content);
      renderer.apply(recovery.polish!);
    });
    expect(renderer.getLastRejection()).toBeNull();
    renderer.destroy();
  });
});
