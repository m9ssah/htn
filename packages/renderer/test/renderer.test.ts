import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentPatch, PolishPatch, SkeletonPatch, StylePatch, TemplateId } from '@jit/schema';
import { checkContrast, resolve } from '@jit/tokens';
import {
  BOOTSTRAP_THEME,
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
    '--jit-bg': '#fdf2f4',
    '--jit-surface': '#fffafb',
    '--jit-border': '#f0d3dc',
    '--jit-accent': '#a8325c',
    '--jit-on-accent': '#fffafc',
    '--jit-fg': '#432630',
    '--jit-muted': '#7d5460',
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
    forward.applySkeleton(skeleton('auth_form'));
    forward.applyContent(fullContent('auth_form'));

    const backward = createRenderer(document.createElement('div'));
    backward.applyContent(fullContent('auth_form'));
    backward.applySkeleton(skeleton('auth_form'));

    expect(backward.getActions()).toEqual(forward.getActions());
  });
});

/* ------------------------------------------------------------------ *
 * 2. Content before skeleton
 * ------------------------------------------------------------------ */

describe('content arriving before its skeleton', () => {
  it('does not throw', () => {
    const renderer = createRenderer(root);
    expect(() => renderer.applyContent(fullContent('dashboard'))).not.toThrow();
  });

  it('buffers, then applies when the structure lands', () => {
    const renderer = createRenderer(root);
    renderer.applyContent(fullContent('dashboard'));
    expect(root.textContent).toBe('');

    renderer.applySkeleton(skeleton('dashboard'));
    expect(root.querySelector('[data-slot="dashboard.title"]')?.textContent).toBe(
      'Heading dashboard.title',
    );
    expect(root.querySelectorAll('[data-shimmer]')).toHaveLength(0);
  });

  it('merges successive partial content patches', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('confirm_action'));
    renderer.applyContent({ v: 1, slots: { 'confirm_action.title': { kind: 'Heading', text: 'A' } } });
    renderer.applyContent({ v: 1, slots: { 'confirm_action.cancel': { kind: 'Button', text: 'B' } } });

    expect(root.querySelector('[data-slot="confirm_action.title"]')?.textContent).toBe('A');
    expect(root.querySelector('[data-slot="confirm_action.cancel"]')?.textContent).toBe('B');
    // The two still-unfilled slots stay shimmering.
    expect(root.querySelectorAll('[data-shimmer]')).toHaveLength(2);
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
    renderer.applySkeleton(skeleton('dashboard'));
    renderer.applyContent(fullContent('dashboard'));
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
    renderer.applySkeleton(skeleton('reader'));
    renderer.applyPolish(polish);
    expect(root.style.getPropertyValue('--jit-radius')).toBe('26px');
    expect(root.style.getPropertyValue('--jit-accent')).toBe('#a8325c');
  });

  it('leaves untouched axes on the enum base', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('reader'));
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
    renderer.applySkeleton(skeleton('dashboard'));
    renderer.applyStyle(style);

    const base = resolve(style.theme);
    renderer.applyPolish(unreadable);

    expect(root.style.getPropertyValue('--jit-bg')).toBe(base['--jit-bg']);
    expect(root.style.getPropertyValue('--jit-fg')).toBe(base['--jit-fg']);
    expect(root.style.getPropertyValue('--jit-surface')).toBe(base['--jit-surface']);
  });

  it('retains the rejection with its ratios, so the failure is debuggable', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('dashboard'));
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

    renderer.applySkeleton(skeleton('dashboard'));
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
    inCard.applySkeleton(skeleton('dashboard'));
    inCard.applyPolish(cardOnly);
    expect(inCard.getLastRejection()).toBeNull();

    // reader has no Card and paints straight onto bg, so the same set fails.
    const onBg = createRenderer(document.createElement('div'));
    onBg.applySkeleton(skeleton('reader'));
    onBg.applyPolish(cardOnly);
    expect(onBg.getLastRejection()?.report.pass).toBe(false);
  });

  it('re-evaluates when a later style patch changes the base underneath it', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('reader'));
    renderer.applyPolish({
      v: 1,
      tokens: { '--jit-fg': '#ffffff' },
      interpretedAs: 'white text',
    });
    // White on slate's dark bg passes.
    expect(renderer.getLastRejection()).toBeNull();

    // mono is a light palette; the same white text is now invisible.
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
      task_focus: ['press:mark_in', 'press:mark_out', 'press:confirm'],
      ticket_detail: ['press:view_ticket'],
      auth_form: ['text:enter_email', 'text:enter_password', 'press:submit', 'press:recover'],
      dashboard: [],
      reader: [],
      settings_panel: ['toggle:toggle_1', 'toggle:toggle_2', 'toggle:toggle_3', 'toggle:toggle_4'],
      confirm_action: ['press:cancel', 'press:confirm'],
      progress_task: ['press:cancel'],
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
    renderer.applySkeleton(skeleton('settings_panel'));
    expect(renderer.getActions().map((a) => a.label)).toEqual([null, null, null, null]);

    renderer.applyContent(fullContent('settings_panel'));
    expect(renderer.getActions().map((a) => a.label)).toEqual([
      'Option settings_panel.option1',
      'Option settings_panel.option2',
      'Option settings_panel.option3',
      'Option settings_panel.option4',
    ]);
  });

  it('never exceeds the four physical buttons the device has', () => {
    for (const templateId of TEMPLATE_IDS) {
      const renderer = createRenderer(document.createElement('div'));
      renderer.applySkeleton(skeleton(templateId));
      expect(renderer.getActions().length, templateId).toBeLessThanOrEqual(4);
    }
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
    createRenderer(host).applySkeleton(skeleton('reader'));
    const para = host.querySelector<HTMLElement>('[data-slot="reader.para1"]');
    expect(para?.style.getPropertyValue('--ph-lines')).toBe('3');
    expect(host.querySelector<HTMLElement>('[data-slot="reader.title"]')?.style
      .getPropertyValue('--ph-lines')).toBe('2');
  });

  it('applies the template width from the patch, not the enum default', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton({ v: 1, templateId: 'dashboard', maxWidth: 470 });
    expect(root.style.getPropertyValue('--jit-maxw')).toBe('470px');
  });

  it('paints a declared bootstrap theme before any style patch arrives', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('reader'));
    expect(renderer.getState().themeSource).toBe('bootstrap');
    expect(root.style.getPropertyValue('--jit-bg')).toBe(resolve(BOOTSTRAP_THEME)['--jit-bg']);

    renderer.applyStyle(style);
    expect(renderer.getState().themeSource).toBe('patch');
  });

  it('replaces the previous template cleanly when a new skeleton lands', () => {
    const renderer = createRenderer(root);
    renderer.applySkeleton(skeleton('dashboard'));
    renderer.applySkeleton(skeleton('reader'));
    expect(root.querySelectorAll('[data-slot^="dashboard."]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-slot^="reader."]')).toHaveLength(5);
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
    renderer.applySkeleton(skeleton('dashboard'));
    for (const name of RENDERER_CSS_VARS) {
      expect(root.style.getPropertyValue(name), name).not.toBe('');
    }
    expect(checkContrast(renderer.getState().tokens!).pass).toBe(true);
  });
});
