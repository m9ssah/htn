import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolishPatch, SkeletonPatch, StylePatch, TemplateId } from '@jit/schema';
import { BUTTON_COUNT, RANGE_CONTROL_COUNT } from '@jit/schema';
import { checkContrast, resolve } from '@jit/tokens';
import {
  BOOTSTRAP_THEME,
  EXIT_DURATION_MS,
  POLISH_REJECTED_EVENT,
  RENDERER_CSS_VARS,
  TEMPLATES,
  TEMPLATE_IDS,
  createRenderer,
  type TelemetryEvent,
} from '@jit/renderer';
import { canonical, fullContent, permutations, slotsOf } from './fixtures.js';

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
});

const skeleton = (templateId: TemplateId): SkeletonPatch => ({
  v: 1,
  templateId,
  maxWidth: TEMPLATES[templateId].maxWidth,
});

const style: StylePatch = {
  v: 1,
  theme: {
    palette: 'rose',
    fontPairing: 'editorial',
    density: 'spacious',
    radius: 'round',
    motif: 'floral',
  },
};

/** A readable polish set — passes AA on both bg and surface. */
const polish: PolishPatch = {
  v: 1,
  tokens: {
    '--jit-bg': '#1d0a14',
    '--jit-surface': '#271020',
    '--jit-border': '#3e1e2e',
    '--jit-accent': '#d64a7e',
    '--jit-on-accent': '#1a0a12',
    '--jit-fg': '#f7eaf0',
    '--jit-muted': '#bb95a6',
    '--jit-radius': '26px',
  },
  interpretedAs: 'soft, calm, generous air',
};

/* ------------------------------------------------------------------ *
 * 1. Patch order independence
 * ------------------------------------------------------------------ */

describe('patches arrive in any order', () => {
  it('produces identical DOM for all 24 orderings, on every template', () => {
    for (const templateId of TEMPLATE_IDS) {
      const content = fullContent(templateId);
      const apply = {
        skeleton: (r: ReturnType<typeof createRenderer>) => r.applySkeleton(skeleton(templateId)),
        content: (r: ReturnType<typeof createRenderer>) => r.applyContent(content),
        style: (r: ReturnType<typeof createRenderer>) => r.applyStyle(style),
        polish: (r: ReturnType<typeof createRenderer>) => r.applyPolish(polish),
      };
      const orderings = permutations(Object.keys(apply) as (keyof typeof apply)[]);
      expect(orderings).toHaveLength(24);

      let expected: string | null = null;
      for (const ordering of orderings) {
        const host = document.createElement('div');
        const renderer = createRenderer(host);
        for (const step of ordering) apply[step](renderer);

        const actual = canonical(host);
        if (expected === null) expected = actual;
        else expect(actual, `${templateId} / ${ordering.join(' -> ')}`).toBe(expected);
      }
    }
  });

  it('keeps getActions() identical regardless of ordering', () => {
    const forward = createRenderer(document.createElement('div'));
    forward.applySkeleton(skeleton('item_detail'));
    forward.applyContent(fullContent('item_detail'));

    const backward = createRenderer(document.createElement('div'));
    backward.applyContent(fullContent('item_detail'));
    backward.applySkeleton(skeleton('item_detail'));

    expect(backward.getActions()).toEqual(forward.getActions());
  });
});

/* ------------------------------------------------------------------ *
 * 2. Content before skeleton
 * ------------------------------------------------------------------ */

describe('content arriving before its skeleton', () => {
  it('does not throw', () => {
    const renderer = createRenderer(root);
    expect(() => renderer.applyContent(fullContent('item_detail'))).not.toThrow();
  });

  it('buffers, then applies when the structure lands', () => {
    const renderer = createRenderer(root);
    renderer.applyContent(fullContent('item_detail'));
    expect(root.textContent).toBe('');

    renderer.applySkeleton(skeleton('item_detail'));
    expect(root.querySelector('[data-slot="item_detail.title"]')?.textContent).toBe(
      'Heading item_detail.title',
    );
    expect(root.querySelectorAll('[data-shimmer]')).toHaveLength(0);
  });

  it('merges successive partial content patches', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('recovery'));
    renderer.applyContent({ v: 1, slots: { 'recovery.title': { kind: 'Heading', text: 'A' } } });
    renderer.applyContent({ v: 1, slots: { 'recovery.primary': { kind: 'Button', text: 'B' } } });

    expect(root.querySelector('[data-slot="recovery.title"]')?.textContent).toBe('A');
    expect(root.querySelector('[data-slot="recovery.primary"]')?.textContent).toBe('B');
    // The six still-unfilled slots stay shimmering.
    expect(root.querySelectorAll('[data-shimmer]')).toHaveLength(6);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Polish is a repaint, not a relayout
 * ------------------------------------------------------------------ */

describe('applying a polish patch', () => {
  it('mutates only custom properties on the root — no node, no class, no attribute', async () => {
    // happy-dom performs no layout, so measuring boxes would assert nothing.
    // Proving that the patch touches no node at all is the stronger claim: a
    // change that cannot reach the tree cannot move it.
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applyContent(fullContent('item_detail'));
    renderer.applyStyle(style);

    const before = root.innerHTML;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    renderer.applyPolish(polish);
    await Promise.resolve();
    observer.disconnect();

    for (const record of records) {
      expect(record.type).toBe('attributes');
      expect(record.attributeName).toBe('style');
      expect(record.target).toBe(root);
    }
    expect(root.innerHTML).toBe(before);
  });

  it('actually changes the tokens it was given', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('generic_answer'));
    renderer.applyPolish(polish);
    expect(root.style.getPropertyValue('--jit-radius')).toBe('26px');
    expect(root.style.getPropertyValue('--jit-accent')).toBe('#d64a7e');
  });

  it('leaves untouched axes on the enum base', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('generic_answer'));
    renderer.applyStyle(style);
    renderer.applyPolish(polish);
    expect(root.style.getPropertyValue('--jit-gap')).toBe(resolve(style.theme)['--jit-gap']);
  });
});

/* ------------------------------------------------------------------ *
 * Contrast gate
 * ------------------------------------------------------------------ */

describe('a polish patch that fails AA', () => {
  const unreadable: PolishPatch = {
    v: 1,
    tokens: { '--jit-bg': '#3a3a3a', '--jit-surface': '#3a3a3a', '--jit-fg': '#464646' },
    interpretedAs: 'moody and low contrast',
  };

  it('is rejected whole — not partially applied', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applyStyle(style);

    const base = resolve(style.theme);
    renderer.applyPolish(unreadable);

    expect(root.style.getPropertyValue('--jit-bg')).toBe(base['--jit-bg']);
    expect(root.style.getPropertyValue('--jit-fg')).toBe(base['--jit-fg']);
    expect(root.style.getPropertyValue('--jit-surface')).toBe(base['--jit-surface']);
  });

  it('retains the rejection with its ratios, so the failure is debuggable', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applyPolish(unreadable);

    const rejection = renderer.getLastRejection();
    expect(rejection?.patch).toBe(unreadable);
    expect(rejection?.report.pass).toBe(false);
    expect(rejection?.report.checks.some((c) => c.pass === false && c.ratio !== null)).toBe(true);
  });

  it('reports the failure rather than failing silently', () => {
    const onTelemetry = vi.fn<(event: TelemetryEvent) => void>();
    const renderer = createRenderer(root, { onTelemetry });
    const seen: unknown[] = [];
    root.addEventListener(POLISH_REJECTED_EVENT, (e) => seen.push((e as CustomEvent).detail));

    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applyPolish(unreadable);

    expect(seen).toHaveLength(1);
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'polish-rejected', interpretedAs: 'moody and low contrast' }),
    );
  });

  it('judges against the grounds the template actually paints on', () => {
    // A dark page behind a light card. Unreadable on bg, fine on surface.
    const cardOnly: PolishPatch = {
      v: 1,
      tokens: {
        '--jit-bg': '#1b1b1d',
        '--jit-surface': '#fbfaf7',
        '--jit-fg': '#18181a',
        '--jit-muted': '#6b665e',
      },
      interpretedAs: 'ticket stock on a dark page',
    };

    // dashboard renders inside a Card, so only the surface pairs are required.
    const inCard = createRenderer(document.createElement('div'));
    inCard.applySkeleton(skeleton('item_detail'));
    inCard.applyPolish(cardOnly);
    expect(inCard.getLastRejection()).toBeNull();

    // reader has no Card and paints straight onto bg, so the same set fails.
    const onBg = createRenderer(document.createElement('div'));
    onBg.applySkeleton(skeleton('generic_answer'));
    onBg.applyPolish(cardOnly);
    expect(onBg.getLastRejection()?.report.pass).toBe(false);
  });

  it('re-evaluates when a later style patch changes the base underneath it', () => {
    /*
     * #7b7b7b has a relative luminance of 0.198. `contrast` paints its Card on
     * pure black, which needs 0.175 to clear AA, so the grey passes there;
     * `mono`'s Card is #1c191d, which needs 0.221, so the same grey fails once
     * the base moves under it. Every ground is dark now, and that ~0.046 window
     * between the darkest and lightest of them is the whole range there is —
     * which is itself the point: enforcing a dark ground leaves the contrast
     * gate much less room to swing.
     */
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applyStyle({ v: 1, theme: { ...BOOTSTRAP_THEME, palette: 'contrast' } });
    renderer.applyPolish({
      v: 1,
      tokens: { '--jit-fg': '#7b7b7b' },
      interpretedAs: 'mid grey text',
    });
    expect(renderer.getLastRejection()).toBeNull();

    renderer.applyStyle({ v: 1, theme: { ...BOOTSTRAP_THEME, palette: 'mono' } });
    expect(renderer.getLastRejection()?.report.pass).toBe(false);
    expect(root.style.getPropertyValue('--jit-fg')).toBe(resolve({
      ...BOOTSTRAP_THEME,
      palette: 'mono',
    })['--jit-fg']);
  });
});

/* ------------------------------------------------------------------ *
 * 4. getActions
 * ------------------------------------------------------------------ */

describe('getActions', () => {
  it('returns [] before a skeleton exists', () => {
    expect(createRenderer(root).getActions()).toEqual([]);
  });

  it('returns the right descriptors, in DOM order, for all 8 templates', () => {
    const summary: Record<string, string[]> = {};
    for (const templateId of TEMPLATE_IDS) {
      const renderer = createRenderer(document.createElement('div'));
      renderer.applySkeleton(skeleton(templateId));
      summary[templateId] = renderer.getActions().map((a) => `${a.kind}:${a.action}`);
    }

    expect(summary).toEqual({
      choice_cards: ['range:set_preference', 'press:select_1', 'press:select_2', 'press:select_3'],
      item_detail: ['range:set_amount', 'press:begin'],
      focus_step: ['press:prev_step', 'press:next_step', 'press:step_done'],
      recovery: ['press:start_over', 'press:apply_fix'],
      // Deliberately actionless: the script calls for an open prompt here, so
      // the LEDs going dark is the correct behaviour, not a gap.
      summary_done: [],
      people_picker: ['press:pick_1', 'press:pick_2', 'press:pick_3', 'press:write_messages'],
      message_drafts: ['range:set_tone', 'press:edit', 'press:send'],
      generic_answer: ['press:primary_action'],
    });
  });

  it('matches the DOM order of the rendered controls', () => {
    for (const templateId of TEMPLATE_IDS) {
      const host = document.createElement('div');
      const renderer = createRenderer(host);
      renderer.applySkeleton(skeleton(templateId));

      const inDom = [...host.querySelectorAll('[data-action]')].map(
        (el) => (el as HTMLElement).dataset['action'],
      );
      expect(renderer.getActions().map((a) => a.action), templateId).toEqual(inDom);
    }
  });

  it('is available at skeleton paint, with labels null until content lands', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('people_picker'));
    expect(renderer.getActions().map((a) => a.label)).toEqual([null, null, null, null]);

    renderer.applyContent(fullContent('people_picker'));
    expect(renderer.getActions().map((a) => a.label)).toEqual([
      'Item people_picker.person1',
      'Item people_picker.person2',
      'Item people_picker.person3',
      'Press people_picker.confirm',
    ]);
  });

  it('never exceeds the hardware: four buttons and one fader', () => {
    for (const templateId of TEMPLATE_IDS) {
      const renderer = createRenderer(document.createElement('div'));
      renderer.applySkeleton(skeleton(templateId));
      const actions = renderer.getActions();
      const ranges = actions.filter((a) => a.kind === 'range');
      const pressable = actions.filter((a) => a.kind !== 'range');
      expect(pressable.length, `${templateId} buttons`).toBeLessThanOrEqual(BUTTON_COUNT);
      expect(ranges.length, `${templateId} faders`).toBeLessThanOrEqual(RANGE_CONTROL_COUNT);
    }
  });

  it('carries the generated axis once content lands, and null before', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));

    const before = renderer.getActions().find((a) => a.kind === 'range');
    expect(before).toMatchObject({ kind: 'range', range: null, label: null });

    renderer.applyContent({
      v: 1,
      slots: {
        'item_detail.axis': {
          kind: 'Slider',
          label: 'Batch size',
          min: 12,
          max: 30,
          step: 6,
          value: 18,
          unit: 'cookies',
        },
      },
    });

    expect(renderer.getActions().find((a) => a.kind === 'range')).toMatchObject({
      kind: 'range',
      label: 'Batch size',
      range: { min: 12, max: 30, step: 6, value: 18, unit: 'cookies' },
    });
  });

  it('gives the same fader a different meaning on each surface', () => {
    // The demo's first moment: one physical control, three generated meanings.
    const meanings = (['choice_cards', 'item_detail', 'message_drafts'] as const).map((id) => {
      const renderer = createRenderer(document.createElement('div'));
      renderer.applySkeleton(skeleton(id));
      return renderer.getActions().find((a) => a.kind === 'range')?.action;
    });
    expect(meanings).toEqual(['set_preference', 'set_amount', 'set_tone']);
  });

  it('gives every action a unique string within its template', () => {
    for (const templateId of TEMPLATE_IDS) {
      const renderer = createRenderer(document.createElement('div'));
      renderer.applySkeleton(skeleton(templateId));
      const actions = renderer.getActions().map((a) => a.action);
      expect(new Set(actions).size, templateId).toBe(actions.length);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Skeleton and shimmer
 * ------------------------------------------------------------------ */

describe('the skeleton', () => {
  it('shimmers every slot it has no value for', () => {
    for (const templateId of TEMPLATE_IDS) {
      const host = document.createElement('div');
      createRenderer(host).applySkeleton(skeleton(templateId));
      expect(host.querySelectorAll('[data-shimmer]').length, templateId).toBe(
        slotsOf(TEMPLATES[templateId]).length,
      );
    }
  });

  it('reserves a box for every slot that declares one', () => {
    const host = document.createElement('div');
    createRenderer(host).applySkeleton(skeleton('generic_answer'));
    expect(
      host.querySelector<HTMLElement>('[data-slot="generic_answer.body"]')?.style
        .getPropertyValue('--ph-lines'),
    ).toBe('3');
    expect(
      host.querySelector<HTMLElement>('[data-slot="generic_answer.title"]')?.style
        .getPropertyValue('--ph-lines'),
    ).toBe('2');
  });

  it('collapses a slot the instance does not use, instead of shimmering forever', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));

    const slot = () => root.querySelector<HTMLElement>('[data-slot="item_detail.line8"]');
    expect(slot()?.hidden).toBe(false);
    expect(slot()?.hasAttribute('data-shimmer')).toBe(true);

    renderer.applyContent({ v: 1, slots: { 'item_detail.line8': null } });
    expect(slot()?.hidden).toBe(true);
  });

  it('drains a null that arrived before the skeleton', () => {
    const renderer = createRenderer(root);
    renderer.applyContent({ v: 1, slots: { 'item_detail.line8': null } });
    renderer.applySkeleton(skeleton('item_detail'));
    expect(
      root.querySelector<HTMLElement>('[data-slot="item_detail.line8"]')?.hidden,
    ).toBe(true);
  });

  it('applies the template width from the patch, not the enum default', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton({ v: 1, templateId: 'item_detail', maxWidth: 470 });
    expect(root.style.getPropertyValue('--jit-maxw')).toBe('470px');
  });

  it('paints a declared bootstrap theme before any style patch arrives', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('generic_answer'));
    expect(renderer.getState().themeSource).toBe('bootstrap');
    expect(root.style.getPropertyValue('--jit-bg')).toBe(resolve(BOOTSTRAP_THEME)['--jit-bg']);

    renderer.applyStyle(style);
    expect(renderer.getState().themeSource).toBe('patch');
  });

  it('replaces the previous template cleanly when a new skeleton lands', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    renderer.applySkeleton(skeleton('generic_answer'));
    expect(root.querySelectorAll('[data-slot^="item_detail."]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-slot^="generic_answer."]')).toHaveLength(6);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Token coverage — the renderer's contract with @jit/tokens
 * ------------------------------------------------------------------ */

describe('token coverage', () => {
  it('resolve() emits every var the renderer reads', () => {
    const resolved = resolve(BOOTSTRAP_THEME);
    for (const name of RENDERER_CSS_VARS) {
      expect(resolved[name], name).toBeDefined();
      expect(resolved[name], name).not.toBe('');
    }
  });

  it('emits nothing the renderer does not read', () => {
    expect(Object.keys(resolve(BOOTSTRAP_THEME)).sort()).toEqual([...RENDERER_CSS_VARS].sort());
  });

  it('paints a complete, AA-passing surface from a bare skeleton patch', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('item_detail'));
    for (const name of RENDERER_CSS_VARS) {
      expect(root.style.getPropertyValue(name), name).not.toBe('');
    }
    expect(checkContrast(renderer.getState().tokens!).pass).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Surface transitions
 * ------------------------------------------------------------------ */

describe('transitioning between surfaces', () => {
  it('cuts straight over when transitions are off, which is the default', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('choice_cards'));
    renderer.applySkeleton(skeleton('focus_step'));

    expect(root.children).toHaveLength(1);
    expect(root.querySelectorAll('[data-exiting]')).toHaveLength(0);
  });

  it('keeps the outgoing surface on screen while the new one arrives', () => {
    const renderer = createRenderer(root, { transitions: true });
    renderer.applySkeleton(skeleton('choice_cards'));
    renderer.applySkeleton(skeleton('focus_step'));

    // Both trees are present: the old one pivoting away, the new one arriving.
    expect(root.children).toHaveLength(2);
    expect(root.querySelectorAll('[data-exiting]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-entering]')).toHaveLength(1);
    // The incoming surface is the one that owns the slots.
    expect(root.querySelector('[data-entering] [data-slot^="focus_step."]')).not.toBeNull();
  });

  it('removes the outgoing surface once it has left', async () => {
    vi.useFakeTimers();
    try {
      const renderer = createRenderer(root, { transitions: true });
      renderer.applySkeleton(skeleton('choice_cards'));
      renderer.applySkeleton(skeleton('focus_step'));
      expect(root.children).toHaveLength(2);

      vi.advanceTimersByTime(EXIT_DURATION_MS + 1);
      expect(root.children).toHaveLength(1);
      expect(root.querySelector('[data-slot^="focus_step."]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stacks two outgoing surfaces', () => {
    // Three surfaces in quick succession — overlapping exits read as a glitch.
    const renderer = createRenderer(root, { transitions: true });
    renderer.applySkeleton(skeleton('choice_cards'));
    renderer.applySkeleton(skeleton('focus_step'));
    renderer.applySkeleton(skeleton('recovery'));

    expect(root.querySelectorAll('[data-exiting]')).toHaveLength(1);
    expect(root.children).toHaveLength(2);
  });

  it('numbers slots in DOM order so the entrance can stagger', () => {
    const renderer = createRenderer(root, { transitions: true });
    renderer.applySkeleton(skeleton('choice_cards'));

    const indices = [...root.querySelectorAll<HTMLElement>('[data-slot], .c-divider')].map((el) =>
      Number(el.style.getPropertyValue('--i')),
    );
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices[0]).toBe(0);
  });

  it('still applies buffered content to the incoming surface mid-transition', () => {
    const renderer = createRenderer(root, { transitions: true });
    renderer.applySkeleton(skeleton('choice_cards'));
    renderer.applySkeleton(skeleton('recovery'));
    renderer.applyContent({
      v: 1,
      slots: { 'recovery.title': { kind: 'Heading', text: 'Too much sugar' } },
    });

    expect(root.querySelector('[data-entering] [data-slot="recovery.title"]')?.textContent).toBe(
      'Too much sugar',
    );
  });
});
