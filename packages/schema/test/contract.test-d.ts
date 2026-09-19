import { describe, expectTypeOf, it } from 'vitest';
import type {
  ActionDescriptor,
  ContentPatch,
  PolishPatch,
  SkeletonPatch,
  SlotsOf,
  SlotValueFor,
  StylePatch,
  ThemeEnums,
} from '@jit/schema';

/**
 * These assertions are the whole point of the package: the contract has to fail
 * at compile time, not at render time on stage.
 */
describe('ThemeEnums', () => {
  it('accepts a legal theme', () => {
    expectTypeOf<{
      palette: 'slate';
      fontPairing: 'editorial';
      density: 'spacious';
      radius: 'round';
      motif: 'floral';
    }>().toExtend<ThemeEnums>();
  });

  it('rejects a palette that is not in the table', () => {
    const theme: ThemeEnums = {
      // @ts-expect-error 'violet' was cut from the palette table
      palette: 'violet',
      fontPairing: 'system',
      density: 'normal',
      radius: 'soft',
      motif: 'none',
    };
    void theme;
  });

  it('rejects a free-form string on any axis', () => {
    const theme: ThemeEnums = {
      palette: 'slate',
      fontPairing: 'system',
      density: 'normal',
      radius: 'soft',
      // @ts-expect-error Jev returns typed values only; never a free-form string
      motif: 'art-deco',
    };
    void theme;
  });
});

describe('ContentPatch', () => {
  it('binds a slot to the one component kind that consumes it', () => {
    expectTypeOf<SlotValueFor<'recovery.outcome'>>().toEqualTypeOf<{
      kind: 'Metric';
      label: string;
      value: string;
      delta?: string;
    }>();
  });

  it('binds the three sliders to the Slider variant', () => {
    expectTypeOf<SlotValueFor<'choice_cards.axis'>>().toEqualTypeOf<
      SlotValueFor<'message_drafts.tone'>
    >();
    expectTypeOf<SlotValueFor<'recipe_overview.batch'>>().toExtend<{ kind: 'Slider' }>();
  });

  it('rejects a value of the wrong kind for a slot', () => {
    const patch: ContentPatch = {
      v: 1,
      // @ts-expect-error outcome is a Metric slot, not a Heading slot
      slots: { 'recovery.outcome': { kind: 'Heading', text: 'nope' } },
    };
    void patch;
  });

  it('rejects a slot ID that belongs to no template', () => {
    const patch: ContentPatch = {
      v: 1,
      // @ts-expect-error no such slot
      slots: { 'recovery.profit': { kind: 'Metric', label: 'a', value: 'b' } },
    };
    void patch;
  });

  it('is partial — slots may arrive one at a time', () => {
    const patch: ContentPatch = { v: 1, slots: {} };
    void patch;
  });

  it('accepts null for a slot this instance does not use', () => {
    // A six-ingredient recipe in a template that reserves eight.
    const patch: ContentPatch = { v: 1, slots: { 'recipe_overview.ingredient7': null } };
    void patch;
  });
});

describe('SlotsOf', () => {
  it('derives a template’s slots from the ID prefix', () => {
    expectTypeOf<SlotsOf<'summary_done'>>().toEqualTypeOf<
      'summary_done.title' | 'summary_done.result' | 'summary_done.prompt'
    >();
  });
});

describe('the other three patches', () => {
  it('SkeletonPatch carries structure only', () => {
    const patch: SkeletonPatch = { v: 1, templateId: 'focus_step', maxWidth: 560 };
    void patch;
  });

  it('SkeletonPatch rejects an unknown template', () => {
    // @ts-expect-error 'ticket_detail' was retired in the pivot
    const patch: SkeletonPatch = { v: 1, templateId: 'ticket_detail', maxWidth: 440 };
    void patch;
  });

  it('StylePatch carries no raw values', () => {
    const patch: StylePatch = {
      v: 1,
      theme: {
        palette: 'contrast',
        fontPairing: 'geometric',
        density: 'compact',
        radius: 'sharp',
        motif: 'none',
      },
    };
    void patch;
  });

  it('PolishPatch takes raw tokens, but only for vars the renderer reads', () => {
    const patch: PolishPatch = {
      v: 1,
      tokens: { '--jit-bg': '#0a0b0d', '--jit-accent': '#4ade80' },
      interpretedAs: 'pared-back cutting tool, nothing decorative',
    };
    void patch;
  });

  it('PolishPatch rejects an invented CSS var', () => {
    const patch: PolishPatch = {
      v: 1,
      // @ts-expect-error the renderer would never read this
      tokens: { '--jit-glow': '0 0 12px red' },
      interpretedAs: 'glowy',
    };
    void patch;
  });
});

describe('ActionDescriptor', () => {
  it('allows a null label, because getActions() runs before content lands', () => {
    const action: ActionDescriptor = {
      index: 0,
      action: 'apply_fix',
      kind: 'press',
      slot: 'recovery.primary',
      label: null,
    };
    void action;
  });

  it('carries the generated axis on a range action', () => {
    const action: ActionDescriptor = {
      index: 0,
      action: 'set_batch',
      kind: 'range',
      slot: 'recipe_overview.batch',
      label: 'Batch size',
      range: {
        min: 12,
        max: 30,
        step: 6,
        value: 18,
        unit: 'cookies',
        minLabel: null,
        maxLabel: null,
      },
    };
    void action;
  });

  it('allows a null range, for the same reason it allows a null label', () => {
    const action: ActionDescriptor = {
      index: 0,
      action: 'set_tone',
      kind: 'range',
      slot: 'message_drafts.tone',
      label: null,
      range: null,
    };
    void action;
  });

  it('will not let a press action carry a range', () => {
    const action: ActionDescriptor = {
      index: 0,
      action: 'send',
      kind: 'press',
      slot: 'message_drafts.send',
      label: null,
      // @ts-expect-error a press has no axis
      range: null,
    };
    void action;
  });
});
