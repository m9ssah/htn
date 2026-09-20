import { describe, expect, it } from 'vitest';
import { BUTTON_COUNT_V2, RANGE_CONTROL_COUNT_V2, SurfaceSpecSchema, type SurfaceSpec } from '@jit/schema';
import { JIT_CATALOG } from '@jit/renderer';
import {
  composeProjected,
  projectedComposer,
  validateProjectedSpec,
  MAX_INGREDIENT_ROWS,
  ITEM_DETAIL_FIXED_ELEMENTS,
  MAX_SURFACE_ELEMENTS,
  type ProjectedInput,
} from '../../src/compose/projected.js';
import { estimateSpecHeight } from '../../src/compose/height.js';
import { deriveContentRequest } from '../../src/contract/content.js';
import type { StructureComposer } from '../../src/contract/compose.js';
import { completeStep, type Recipe, type TaskState } from '../../src/domain/recipe.js';
import { CLASSIC_CHOCOLATE_CHIP } from '../../src/domain/recipes.js';
import { CHOICE_OPTIONS, CONTACTS } from '../../src/seed.js';

const ids = { requestId: 'req-1', generationId: 'gen-1' };
/** What an 800x480 panel leaves a surface once the rail and utterance bar take their rows. */
const PANEL_STAGE = 364;

const fresh = (recipe: Recipe = CLASSIC_CHOCOLATE_CHIP): TaskState => ({ recipe, scale: 1, stepIndex: 0, inBowl: {} });
/** A bowl that has drifted from the plan, which is what `recovery` renders. */
const offPlan = (): TaskState => ({ ...fresh(), inBowl: { caster_sugar: 2.25 } });

/** A recipe shape nobody seeded: 3 ingredients, 3 steps, a different unit. */
const TINY: Recipe = {
  id: 'tiny',
  name: 'Two-Ingredient Flatbread',
  baseYield: 6,
  yieldUnit: 'flatbreads',
  minutes: 20,
  ingredients: [
    { id: 'flour', name: 'Self-raising flour', amount: 1.5, unit: 'cup', pricePerUnit: 0.5 },
    { id: 'yoghurt', name: 'Greek yoghurt', amount: 1, unit: 'cup', pricePerUnit: 2.1 },
    { id: 'salt', name: 'Salt', amount: 0.5, unit: 'tsp', pricePerUnit: 0.01 },
  ],
  steps: [
    { id: 't1', instruction: 'Mix the flour and yoghurt', adds: ['flour', 'yoghurt'] },
    { id: 't2', instruction: 'Knead and season', adds: ['salt'] },
    { id: 't3', instruction: 'Fry each side for two minutes', adds: [] },
  ],
};

/** Sixteen ingredients over a twelve-row surface — the overflow case. */
const BIG: Recipe = {
  ...CLASSIC_CHOCOLATE_CHIP,
  id: 'big',
  name: 'Everything Loaf',
  ingredients: [
    ...CLASSIC_CHOCOLATE_CHIP.ingredients,
    { id: 'oats', name: 'Rolled oats', amount: 1, unit: 'cup', pricePerUnit: 0.4 },
    { id: 'walnuts', name: 'Walnuts', amount: 0.5, unit: 'cup', pricePerUnit: 3.1 },
    { id: 'cinnamon', name: 'Cinnamon', amount: 2, unit: 'tsp', pricePerUnit: 0.2 },
    { id: 'raisins', name: 'Raisins', amount: 0.5, unit: 'cup', pricePerUnit: 1.2 },
    { id: 'honey', name: 'Honey', amount: 2, unit: 'tbsp', pricePerUnit: 0.6 },
    { id: 'seeds', name: 'Pumpkin seeds', amount: 0.25, unit: 'cup', pricePerUnit: 2.4 },
    { id: 'nutmeg', name: 'Nutmeg', amount: 1, unit: 'tsp', pricePerUnit: 0.5 },
  ],
};

const FOUR: ReadonlyArray<[string, ProjectedInput]> = [
  ['item_detail', { kind: 'item_detail', state: fresh() }],
  ['focus_step', { kind: 'focus_step', state: completeStep(fresh()) }],
  [
    'recovery',
    {
      kind: 'recovery',
      state: { ...completeStep(fresh()), inBowl: { ...completeStep(fresh()).inBowl, caster_sugar: 1.5 } },
    },
  ],
  ['summary_done', { kind: 'summary_done', state: { ...fresh(), scale: 2, stepIndex: 7 } }],
];

const ALL: ReadonlyArray<[string, ProjectedInput]> = [
  ...FOUR,
  ['choice_cards', { kind: 'choice_cards', options: CHOICE_OPTIONS }],
  ['people_picker', { kind: 'people_picker', contacts: CONTACTS }],
];

/** The renderer's own catalog is the source of truth for "a real prop name". */
const catalogProps = (type: string): string[] => {
  const components = (JIT_CATALOG as unknown as { data: { components: Record<string, { props: { shape: object } }> } })
    .data.components;
  return Object.keys(components[type]?.props.shape ?? {});
};

type Pointer = { element: string; field: string; prop: string; owner: string; type: string };

function pointers(spec: SurfaceSpec): Pointer[] {
  return Object.entries(spec.elements).flatMap(([owner, element]) =>
    Object.entries(element.props).flatMap(([prop, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('$state' in value)) return [];
      const match = /^\/content\/([^/]+)\/([^/]+)$/.exec((value as { $state: string }).$state);
      if (!match) return [{ element: '<malformed>', field: '<malformed>', prop, owner, type: element.type }];
      return [{ element: match[1]!, field: match[2]!, prop, owner, type: element.type }];
    }),
  );
}

/**
 * The headline claim, compiled rather than asserted in a comment: the graph
 * must never learn which composer it has. `StructureComposerLike` is declared
 * structurally in `compose/projected.ts` (that module is being moved), so this
 * is the only place the two shapes are checked against each other.
 */
const _seam: StructureComposer = projectedComposer({ kind: 'summary_done', state: fresh() });
void _seam;

describe('projected composer — every surface is schema-valid and fully bound', () => {
  for (const [name, input] of ALL) {
    it(`${name}: SurfaceSpecSchema.parse accepts the spec`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok, result.ok ? '' : result.reason).toBe(true);
      if (!result.ok) return;
      expect(() => SurfaceSpecSchema.parse(result.structure.spec)).not.toThrow();
      expect(result.structure.status).toBe('complete');
      expect(result.structure.generationId).toBe(result.content.generationId);
    });

    it(`${name}: every $state pointer resolves to its own element key and a real field`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const spec = result.structure.spec;
      const found = pointers(spec);
      expect(found.length).toBeGreaterThan(0);

      for (const p of found) {
        // Rule 2: the element segment IS the element's own key, and the last
        // segment IS the prop it fills. A mismatch shimmers forever.
        expect(p.element, `${p.owner}.${p.prop}`).toBe(p.owner);
        expect(p.field, `${p.owner}.${p.prop}`).toBe(p.prop);
        expect(spec.elements[p.element]).toBeDefined();
        if (p.field === 'pending') {
          // Every pending binding must have content behind it.
          expect(result.content.values[p.owner], `${p.owner} pending with no content`).toBeDefined();
          continue;
        }
        expect(catalogProps(p.type), `${p.type}.${p.field}`).toContain(p.field);
        expect(result.content.values[p.owner]?.[p.field], `${p.owner}.${p.field}`).toBeTypeOf('string');
      }
    });

    it(`${name}: deriveContentRequest finds a target for every bound element`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { request, unresolved } = deriveContentRequest({
        requestId: ids.requestId,
        locale: 'en-CA',
        intent: name,
        context: {},
        spec: result.structure.spec,
      });
      // Every binding this composer emits must be reachable by the device's
      // only content write. `unresolved` is the contract layer's own report
      // of bindings nothing can fill -- the permanent-shimmer class from
      // docs/adr/0001 -- so an empty list is the strongest form of this check.
      expect(unresolved, `unresolved bindings in ${name}`).toEqual([]);
      const targets = new Map(request.targets.map((t) => [t.elementId, t.fields.map((f) => f.name).sort()]));
      for (const [elementId, values] of Object.entries(result.content.values)) {
        expect(targets.get(elementId), `no content target derived for ${elementId}`).toEqual(
          Object.keys(values).sort(),
        );
      }
      expect([...targets.keys()].sort()).toEqual(Object.keys(result.content.values).sort());
    });

    it(`${name}: no duplicate props.id and no duplicate action`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const elements = Object.entries(result.structure.spec.elements);
      const propIds = elements.map(([, e]) => e.props.id).filter((id): id is string => typeof id === 'string');
      expect(new Set(propIds).size).toBe(propIds.length);
      expect(propIds.sort()).toEqual(elements.filter(([, e]) => 'id' in e.props).map(([k]) => k).sort());

      const actions = elements.flatMap(([, e]) => Object.values(e.on ?? {}).map((b) => b.action));
      expect(new Set(actions).size).toBe(actions.length);
    });

    it(`${name}: stays inside the hardware's ${BUTTON_COUNT_V2} buttons and ${RANGE_CONTROL_COUNT_V2} range`, () => {
      const result = composeProjected(input, ids);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const bound = Object.values(result.structure.spec.elements).flatMap((e) => Object.keys(e.on ?? {}));
      expect(bound.filter((k) => k !== 'range').length).toBeLessThanOrEqual(BUTTON_COUNT_V2);
      expect(bound.filter((k) => k === 'range').length).toBeLessThanOrEqual(RANGE_CONTROL_COUNT_V2);
    });
  }
});

describe('projected composer — numbers are fixed props, never bindings', () => {
  it('item_detail puts every slider number in the spec as a literal', () => {
    const result = composeProjected({ kind: 'item_detail', state: { ...fresh(), scale: 2 } }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const batch = result.structure.spec.elements.batch!;
    expect(batch.props).toMatchObject({ min: 18, max: 54, step: 6, value: 36, unit: 'cookies' });
    for (const prop of ['min', 'max', 'step', 'value']) expect(typeof batch.props[prop]).toBe('number');
  });

  it('quantities come from the domain, so a 3x scale shows 3x the flour', () => {
    const one = composeProjected({ kind: 'item_detail', state: fresh() }, ids);
    const three = composeProjected({ kind: 'item_detail', state: { ...fresh(), scale: 3 } }, ids);
    expect(one.ok && three.ok).toBe(true);
    if (!one.ok || !three.ok) return;
    expect(one.content.values.ing_0?.meta).toBe('2 cups');
    expect(three.content.values.ing_0?.meta).toBe('6 cups');
    // Unit-aware rounding survives the projection: eggs stay countable.
    expect(three.content.values.ing_4?.title).toBe('Eggs');
    expect(three.content.values.ing_4?.meta).toBe('6');
  });
});

describe('projected composer — shapes nobody seeded', () => {
  it('projects a 3-ingredient, 3-step recipe', () => {
    const result = composeProjected({ kind: 'item_detail', state: fresh(TINY) }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.structure.spec.elements).filter((k) => k.startsWith('ing_'))).toEqual([
      'ing_0', 'ing_1', 'ing_2',
    ]);
    expect(result.content.values.subtitle?.text).toContain('6 flatbreads');
    // A panel-overflow note is information about the device, not a problem
    // with this recipe's projection.
    expect(result.warnings.filter((w) => !w.includes('below the fold'))).toEqual([]);
  });

  it('projects step 1 of 3 (no Back) and step 3 of 3 (Done, no Next)', () => {
    const first = composeProjected({ kind: 'focus_step', state: fresh(TINY) }, ids);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.content.values.progress?.text).toBe('Step 1 of 3');
    expect(first.structure.spec.elements.prev).toBeUndefined();
    expect(first.content.values.bowl?.text).toBe('The bowl is empty.');

    const last = composeProjected({ kind: 'focus_step', state: { ...fresh(TINY), stepIndex: 2 } }, ids);
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.content.values.progress?.text).toBe('Step 3 of 3');
    expect(last.content.values.next?.text).toBe('Done');
    expect(last.structure.spec.elements.next?.on?.press?.action).toBe('step_done');
  });

  it('projects step 5 of 6 on a seeded-but-shortened recipe', () => {
    const six: Recipe = { ...CLASSIC_CHOCOLATE_CHIP, steps: CLASSIC_CHOCOLATE_CHIP.steps.slice(0, 6) };
    const result = composeProjected({ kind: 'focus_step', state: { ...fresh(six), stepIndex: 4 } }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.values.progress?.text).toBe('Step 5 of 6');
    expect(result.content.values.next?.text).toBe('Next');
    expect(result.structure.spec.elements.prev).toBeDefined();
  });

  it('is total past the last step: warns, still produces a surface', () => {
    const past = { ...fresh(TINY), stepIndex: 3 };
    const result = composeProjected({ kind: 'focus_step', state: past }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toContain('past the last step');
    expect(result.content.values.instruction?.text).toBe('All steps complete');
    expect(result.structure.spec.elements.next).toBeUndefined();
  });

  it('recovers from a deviation on an ingredient nobody scripted', () => {
    const state: TaskState = { ...fresh(TINY), inBowl: { flour: 4.5 } };
    const result = composeProjected({ kind: 'recovery', state }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.values.title?.text).toBe('Self-raising flour looks off');
    // 3x the flour -> the whole batch triples: 6 -> 18 flatbreads.
    expect(result.content.values.outcome?.value).toBe('18');
    expect(result.structure.spec.elements.fix?.on?.press?.action).toBe('apply_fix');
  });

  it('drops apply_fix when the deviation is an under-addition', () => {
    const state: TaskState = { ...fresh(TINY), inBowl: { flour: 0.5 } };
    const result = composeProjected({ kind: 'recovery', state }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structure.spec.elements.fix).toBeUndefined();
    expect(result.content.values.plan?.text).toContain('starting over');
  });
});

describe('projected composer — overflow is visible, never silent', () => {
  it(`names every ingredient past ${MAX_INGREDIENT_ROWS} rows on the final row, and warns`, () => {
    const result = composeProjected({ kind: 'item_detail', state: fresh(BIG) }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = Object.keys(result.structure.spec.elements).filter((k) => k.startsWith('ing_'));
    expect(rows).toHaveLength(MAX_INGREDIENT_ROWS);

    const last = result.content.values[`ing_${MAX_INGREDIENT_ROWS - 1}`]!;
    expect(last.title).toBe('+5 more ingredients');
    for (const name of ['Cinnamon', 'Raisins', 'Honey', 'Pumpkin seeds', 'Nutmeg']) {
      expect(String(last.detail)).toContain(name);
    }
    expect(result.warnings.join(' ')).toContain('did not fit');
  });

  it('the row cap fits the device element budget, so overflow is the only limit', () => {
    expect(MAX_INGREDIENT_ROWS + ITEM_DETAIL_FIXED_ELEMENTS).toBeLessThanOrEqual(MAX_SURFACE_ELEMENTS);
    // The seeded demo recipe must show every ingredient, not "+2 more".
    expect(CLASSIC_CHOCOLATE_CHIP.ingredients.length).toBeLessThanOrEqual(MAX_INGREDIENT_ROWS);
  });

  it('a step that adds more ingredients than fit names the rest', () => {
    const wide: Recipe = {
      ...CLASSIC_CHOCOLATE_CHIP,
      steps: [{ id: 'w1', instruction: 'Tip everything in', adds: ['flour', 'butter', 'caster_sugar', 'eggs', 'salt'] }],
    };
    const result = composeProjected({ kind: 'focus_step', state: fresh(wide) }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // How many rows fit is now a height decision, so the fold row's key is
    // wherever capacity ran out rather than a fixed index.
    const fold = Object.entries(result.content.values)
      .find(([key, v]) => key.startsWith('add_') && String(v.title).startsWith('+'));
    expect(fold, 'a fold row naming the remainder').toBeDefined();
    const [, values] = fold!;
    expect(String(values.title)).toMatch(/^\+\d+ more$/);
    expect(String(values.detail)).toContain('Salt');
    expect(result.warnings.join(' ')).toContain('adds 5 ingredients');
  });

  /**
   * The reason the height budget exists: `focus_step` measured 431px against
   * a 364px stage on the real panel, which put its primary button below the
   * fold. Asserted per template so a new one cannot quietly reintroduce it.
   */
  it.each(['item_detail', 'focus_step', 'recovery', 'summary_done'] as const)(
    '%s either fits the panel or says how far over it is',
    (kind) => {
      const result = composeProjected({ kind, state: kind === 'recovery' ? offPlan() : fresh() }, ids);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const height = estimateSpecHeight(result.structure.spec);
      if (height <= PANEL_STAGE) return;
      // Nothing optional is left to fold, so it ships — but never silently.
      expect(result.warnings.join(' '), `${kind} overflows by ${Math.round(height - PANEL_STAGE)}px unreported`)
        .toContain('below the fold');
    },
  );

  /**
   * The templates whose mandatory content alone exceeds the panel. Recorded
   * with real numbers so the next change to any of them is measured against
   * where they actually stand, rather than rediscovered on the device.
   */
  it('reports every surface that will not fit, with the shortfall in pixels', () => {
    for (const kind of ['item_detail', 'recovery', 'summary_done'] as const) {
      const result = composeProjected({ kind, state: kind === 'recovery' ? offPlan() : fresh() }, ids);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const height = estimateSpecHeight(result.structure.spec);
      if (height <= PANEL_STAGE) continue;
      // The shortfall is named in pixels so it can be designed against, rather
      // than being rediscovered by looking at the device.
      expect(result.warnings.join(' '), kind).toMatch(/estimated \d+px against a \d+px stage/);
    }
  });
});

describe('projected composer — refuses to ship a surface the hardware cannot drive', () => {
  it(`fails loudly at ${BUTTON_COUNT_V2 + 1} press actions rather than letting getActions() return []`, () => {
    const contacts = ['ari', 'blake', 'cass', 'dee'].map((id) => ({ id, name: id, near: '5 min away' }));
    const result = composeProjected({ kind: 'people_picker', contacts }, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('exceeds the hardware');
    expect(result.reason).toContain('getActions() would return [] silently');
  });

  it('fails loudly at two range controls', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a', 'b'] },
        a: { type: 'Slider', props: { id: 'a', min: 0, max: 2, step: 1, value: 1 }, on: { range: { action: 'a' } } },
        b: { type: 'Slider', props: { id: 'b', min: 0, max: 2, step: 1, value: 1 }, on: { range: { action: 'b' } } },
      },
    };
    expect(validateProjectedSpec(spec, {})).toContain(`exceeds the hardware's ${RANGE_CONTROL_COUNT_V2}`);
  });

  it('rejects more elements than the device paints', () => {
    const elements: SurfaceSpec['elements'] = { stack: { type: 'Stack', props: {}, children: [] } };
    const children: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      elements[`d${i}`] = { type: 'Divider', props: {} };
      children.push(`d${i}`);
    }
    elements.stack = { type: 'Stack', props: {}, children };
    expect(validateProjectedSpec({ root: 'stack', elements }, {})).toContain('exceeds the device maximum of 24');
  });

  it('rejects a pointer that names another element', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a'] },
        a: { type: 'Heading', props: { id: 'a', text: { $state: '/content/b/text' } } },
      },
    };
    expect(validateProjectedSpec(spec, { a: { text: 'hi' } })).toContain('points at "b"');
  });

  it('rejects a pointer whose field is not the prop it fills', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a'] },
        a: { type: 'Heading', props: { id: 'a', text: { $state: '/content/a/title' } } },
      },
    };
    expect(validateProjectedSpec(spec, { a: { title: 'hi' } })).toContain('points at field "title"');
  });

  it('rejects a binding with no content behind it — the permanent shimmer', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a'] },
        a: { type: 'Heading', props: { id: 'a', text: { $state: '/content/a/text' } } },
      },
    };
    expect(validateProjectedSpec(spec, {})).toContain('binds content but no content value was produced');
  });

  it('rejects a duplicate action', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a', 'b'] },
        a: { type: 'Button', props: { id: 'a' }, on: { press: { action: 'go' } } },
        b: { type: 'Button', props: { id: 'b' }, on: { press: { action: 'go' } } },
      },
    };
    expect(validateProjectedSpec(spec, {})).toContain('duplicate action');
  });

  it('rejects a props.id that is not the element key', () => {
    const spec: SurfaceSpec = {
      root: 'stack',
      elements: {
        stack: { type: 'Stack', props: {}, children: ['a'] },
        a: { type: 'Heading', props: { id: 'other' } },
      },
    };
    expect(validateProjectedSpec(spec, {})).toContain('they must be equal');
  });
});

describe('projected composer — broken domain input fails loudly, never plausibly', () => {
  it('a NaN scale produces no surface and says why', () => {
    const result = composeProjected({ kind: 'item_detail', state: { ...fresh(), scale: Number.NaN } }, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not schema-valid');
  });

  it('an empty recipe still composes, and says there is nothing to show', () => {
    const empty: Recipe = { ...CLASSIC_CHOCOLATE_CHIP, ingredients: [], steps: [] };
    const result = composeProjected({ kind: 'item_detail', state: fresh(empty) }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toContain('no ingredients');
  });
});

describe('projectedComposer — the StructureComposer seam', () => {
  const never = new AbortController().signal;

  it('yields exactly one complete structure event and returns', async () => {
    const seen = [];
    for await (const event of projectedComposer({ kind: 'summary_done', state: fresh() }).compose(
      { intent: 'ignored — the state decides this surface', requestId: 'r', generationId: 'g' },
      never,
    )) {
      seen.push(event);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('structure');
    if (seen[0]?.kind !== 'structure') return;
    expect(seen[0].update.status).toBe('complete');
    expect(seen[0].update.requestId).toBe('r');
    // No model is consulted, so composition cannot cost tokens and cannot be
    // omitted by one. That zero is the point of this path, not an oversight.
    expect(seen[0].completion?.inputTokens).toBe(0);
  });

  it('reports a surface the hardware cannot drive instead of yielding it', async () => {
    const contacts = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, near: '5 min away' }));
    const seen = [];
    for await (const event of projectedComposer({ kind: 'people_picker', contacts }).compose(
      { intent: '', requestId: 'r', generationId: 'g' },
      never,
    )) {
      seen.push(event);
    }
    // `ComposeEvent` gained an error channel, so a failure is now REPORTED
    // rather than thrown — and no half-empty spec is ever yielded, which is
    // what constraint 5 actually asks for.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('unavailable');
    if (seen[0]?.kind !== 'unavailable') return;
    expect(seen[0].reason).toMatch(/exceeds the hardware/);
    expect(seen[0].completion.stopReason).toBe('unavailable');
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const iterate = async () => {
      for await (const _ of projectedComposer({ kind: 'summary_done', state: fresh() }).compose(
        { intent: '', requestId: 'r', generationId: 'g' },
        controller.signal,
      )) void _;
    };
    await expect(iterate()).rejects.toThrow();
  });
});

describe('projected composer — latency', () => {
  it('composes every surface far inside the 250ms structure budget', () => {
    const runs = 200;
    const samples: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      for (const [, input] of ALL) composeProjected(input, ids);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const per = (ms: number) => ms / ALL.length;
    const median = per(samples[Math.floor(runs / 2)]!);
    const p99 = per(samples[Math.floor(runs * 0.99)]!);
    // eslint-disable-next-line no-console
    console.log(`[projected] compose per surface: median ${median.toFixed(3)}ms, p99 ${p99.toFixed(3)}ms, max ${per(samples[runs - 1]!).toFixed(3)}ms`);
    expect(p99).toBeLessThan(250);
  });
});
