import { describe, expect, it } from 'vitest';
import { LAYOUTS, type Layout } from '@jit/schema';
import { composeGenerated } from '../src/compose/projected.js';
import { estimateSpecHeight } from '../src/compose/height.js';
import { LAYOUT_DESCRIPTIONS } from '../src/harness/clients/jev-questions.js';

/**
 * The seven shapes an unscripted answer can take.
 *
 * The defect these exist to prevent is not a crash — it is sameness. Every
 * generated answer used to paint one fixed composition, so the device read as
 * a chatbot with a renderer attached. These assert that each archetype is
 * actually a DIFFERENT surface, and that being different did not break any of
 * the rules a fixed composition was trivially satisfying.
 */

const ids = { requestId: 'r', generationId: 'g' };

const composeFor = (layout: Layout, media: { url: string; kind: 'video' | 'image' } | null = null) =>
  composeGenerated('generic_answer', ids, { layout, media });

describe('every archetype composes into a paintable surface', () => {
  it.each(LAYOUTS)('%s composes', (layout) => {
    const result = composeFor(layout, { url: 'https://example.test/x.jpg', kind: 'image' });

    // `composeGenerated` runs the renderer's own validator internally —
    // element count, depth, cycles, reachability, duplicate ids and the
    // hardware action budget — and reports a violation as `ok: false` with
    // the reason, so this IS that assertion rather than a weaker one.
    if (!result.ok) throw new Error(`${layout} did not compose: ${result.reason}`);
    expect(result.structure.spec.root).toBeTruthy();
  });

  /**
   * `Card > Row > Stack > leaf` is EXACTLY the device's MAX_DEPTH of 4, so
   * the two-column archetypes have no room to spare. `comparison` roots at a
   * Stack rather than a Card for this reason; if someone "tidies" it back
   * into a Card the surface stops painting, and this is what says so.
   */
  it.each(LAYOUTS)('%s stays within the device depth limit', (layout) => {
    const result = composeFor(layout, { url: 'https://example.test/x.jpg', kind: 'image' });
    if (!result.ok) throw new Error(result.reason);

    const { elements, root } = result.structure.spec;
    const depthOf = (id: string, depth: number): number => {
      const children = elements[id]?.children ?? [];
      return children.length === 0 ? depth : Math.max(...children.map((c) => depthOf(c, depth + 1)));
    };

    expect(depthOf(root, 1)).toBeLessThanOrEqual(4);
  });

  /**
   * happy-dom performs no layout, so this is an ESTIMATE against the measured
   * NOMINAL table rather than a real measurement — but a layout that blows the
   * budget by 100px is caught here rather than on the device, where `.stage`
   * clips instead of scrolling and the overflow is simply invisible.
   */
  it.each(LAYOUTS)('%s fits an 800x480 panel', (layout) => {
    const result = composeFor(layout, { url: 'https://example.test/x.jpg', kind: 'image' });
    if (!result.ok) throw new Error(result.reason);

    expect(estimateSpecHeight(result.structure.spec)).toBeLessThanOrEqual(364);
  });
});

describe('the archetypes are actually different surfaces', () => {
  /**
   * The whole point. If two archetypes produce the same component multiset,
   * one of them is decoration rather than a shape, and the judge sees the
   * chatbot again.
   */
  it('no two layouts produce the same composition', () => {
    const shapes = new Map<string, Layout>();

    for (const layout of LAYOUTS) {
      const result = composeFor(layout, { url: 'https://example.test/x.jpg', kind: 'image' });
      if (!result.ok) throw new Error(result.reason);

      const signature = Object.values(result.structure.spec.elements)
        .map((el) => el.type)
        .sort()
        .join(',');

      const clash = shapes.get(signature);
      expect(clash, `${layout} composes identically to ${clash}`).toBeUndefined();
      shapes.set(signature, layout);
    }

    expect(shapes.size).toBe(LAYOUTS.length);
  });

  it('leads with the component its name promises', () => {
    const leads: Partial<Record<Layout, string>> = {
      stat_led: 'Metric',
      media_led: 'Media',
      comparison: 'Metric',
      steps: 'ListItem',
      list_dense: 'ListItem',
    };

    for (const [layout, expected] of Object.entries(leads)) {
      const result = composeFor(layout as Layout, { url: 'https://example.test/x.jpg', kind: 'image' });
      if (!result.ok) throw new Error(result.reason);
      const types = Object.values(result.structure.spec.elements).map((el) => el.type);
      expect(types, `${layout} should contain a ${expected}`).toContain(expected);
    }
  });

  /**
   * A dense list is only dense if it actually holds more rows than the shapes
   * that lead with prose. Asserting the count rather than the look is what
   * keeps "dense" from quietly becoming "three bullets" again.
   */
  it('list_dense carries more rows than split or brief', () => {
    const rowsIn = (layout: Layout): number => {
      const result = composeFor(layout);
      if (!result.ok) throw new Error(result.reason);
      return Object.values(result.structure.spec.elements).filter((el) => el.type === 'ListItem').length;
    };

    expect(rowsIn('list_dense')).toBeGreaterThan(rowsIn('split'));
    expect(rowsIn('list_dense')).toBeGreaterThan(rowsIn('brief'));
  });

  it('brief is the sparsest shape — a short answer must not paint a long skeleton', () => {
    const countIn = (layout: Layout): number => {
      const result = composeFor(layout);
      if (!result.ok) throw new Error(result.reason);
      return Object.keys(result.structure.spec.elements).length;
    };

    for (const layout of LAYOUTS) {
      if (layout === 'brief') continue;
      expect(countIn('brief'), `brief should be sparser than ${layout}`).toBeLessThanOrEqual(countIn(layout));
    }
  });
});

describe('media_led without media', () => {
  /**
   * Constraint 5: the failure is visible on the device rather than dressed as
   * a layout choice. A media-led surface with no picture must say so, not
   * paint an empty column and let a judge assume it is still loading.
   */
  it('says so rather than painting an empty frame', () => {
    const result = composeFor('media_led', null);
    if (!result.ok) throw new Error(result.reason);

    const types = Object.values(result.structure.spec.elements).map((el) => el.type);
    expect(types).toContain('Alert');
    expect(types).not.toContain('Media');
    expect(result.warnings.join(' ')).toContain('no media');
  });
});

describe('the layout question', () => {
  it('describes every archetype — an option Jev cannot read is an option it cannot pick', () => {
    expect(Object.keys(LAYOUT_DESCRIPTIONS).sort()).toEqual([...LAYOUTS].sort());
    for (const description of Object.values(LAYOUT_DESCRIPTIONS)) {
      expect(description.length).toBeGreaterThan(20);
    }
  });

  /**
   * The recorded Jev fixtures predate this question, so an unanswered layout
   * must compose rather than throw — and must land on the shape that assumes
   * least, since reserving boxes the content model was never asked to fill is
   * how a surface ends up shimmering for ever.
   */
  it('falls back to brief when Jev did not answer', () => {
    const fallback = composeGenerated('generic_answer', ids, {});
    const brief = composeFor('brief');
    if (!fallback.ok || !brief.ok) throw new Error('did not compose');

    expect(Object.keys(fallback.structure.spec.elements)).toEqual(Object.keys(brief.structure.spec.elements));
  });
});
