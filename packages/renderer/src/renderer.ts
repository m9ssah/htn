import type {
  ActionDescriptor,
  ContentPatch,
  ContrastReport,
  PolishPatch,
  SkeletonPatch,
  SlotId,
  SlotValue,
  StylePatch,
  ThemeEnums,
  TokenSet,
} from '@jit/schema';
import { applyPolish, checkContrast, resolve } from '@jit/tokens';
import { LEAVES, STRUCTURAL_CLASS } from './vocab.js';
import { TEMPLATES, isLeaf, type Template, type TemplateNode } from './templates.js';
import { collectActions } from './actions.js';

/**
 * What the surface looks like before agent 3 has answered.
 *
 * This is not a fallback hiding a failure — it is the declared pre-style state,
 * and `getState().themeSource` reports which one is on screen. Something has to
 * paint under the skeleton, and a blank surface for 900ms is worse than a
 * neutral one.
 */
export const BOOTSTRAP_THEME: ThemeEnums = {
  palette: 'slate',
  fontPairing: 'system',
  density: 'normal',
  radius: 'soft',
  motif: 'none',
};

export type PolishRejection = {
  patch: PolishPatch;
  report: ContrastReport;
  at: number;
};

export type TelemetryEvent =
  | { type: 'skeleton'; templateId: SkeletonPatch['templateId'] }
  | { type: 'content'; slots: SlotId[] }
  | { type: 'style'; theme: ThemeEnums }
  | { type: 'polish-applied'; interpretedAs: string; report: ContrastReport }
  | { type: 'polish-rejected'; interpretedAs: string; report: ContrastReport };

export type RendererOptions = {
  onTelemetry?: (event: TelemetryEvent) => void;
};

export type RendererState = {
  templateId: SkeletonPatch['templateId'] | null;
  themeSource: 'bootstrap' | 'patch';
  theme: ThemeEnums;
  content: Partial<Record<SlotId, SlotValue | null>>;
  polish: PolishPatch | null;
  tokens: TokenSet | null;
};

export type Renderer = {
  applySkeleton: (patch: SkeletonPatch) => void;
  applyContent: (patch: ContentPatch) => void;
  applyStyle: (patch: StylePatch) => void;
  applyPolish: (patch: PolishPatch) => void;
  getActions: () => ActionDescriptor[];
  /** The last polish patch that failed AA, with its ratios. Null if none has. */
  getLastRejection: () => PolishRejection | null;
  getState: () => RendererState;
};

/** Fired on the root when a polish patch is refused. Telemetry, and the harness. */
export const POLISH_REJECTED_EVENT = 'jit:polish-rejected';

export function createRenderer(root: HTMLElement, options: RendererOptions = {}): Renderer {
  let template: Template | null = null;
  let theme: ThemeEnums = BOOTSTRAP_THEME;
  let themeSource: RendererState['themeSource'] = 'bootstrap';
  let polish: PolishPatch | null = null;
  let maxWidth: number | null = null;
  let tokens: TokenSet | null = null;
  let rejection: PolishRejection | null = null;

  /**
   * Content accumulates independently of structure. A content patch that
   * arrives before its skeleton lands here and is drained on build — the four
   * patches are produced by four agents racing each other, so ordering is not
   * something the renderer gets to assume.
   */
  const content: Partial<Record<SlotId, SlotValue | null>> = {};
  const slotElements = new Map<SlotId, HTMLElement>();

  const emit = (event: TelemetryEvent): void => options.onTelemetry?.(event);

  root.classList.add('jit-root');

  /* ---------------------------------------------------------------- *
   * Structure
   * ---------------------------------------------------------------- */

  const buildNode = (node: TemplateNode): HTMLElement => {
    if (isLeaf(node)) {
      const spec = LEAVES[node.type];
      const element = spec.build(node.props ?? {});
      element.dataset['slot'] = node.slot;
      if (node.action !== undefined) element.dataset['action'] = node.action;
      // The reservation that stops content landing from moving the layout.
      if (node.lines !== undefined) {
        element.style.setProperty('--ph-lines', String(node.lines));
      }
      if (node.detail !== undefined) element.dataset['hasDetail'] = String(node.detail);
      const known = content[node.slot];
      spec.fill(element, known ?? undefined);
      if (known === null) element.hidden = true;
      slotElements.set(node.slot, element);
      return element;
    }

    if (node.type === 'Divider') {
      const divider = document.createElement('hr');
      divider.className = STRUCTURAL_CLASS.Divider;
      return divider;
    }

    const element = document.createElement('div');
    element.className = STRUCTURAL_CLASS[node.type];
    for (const child of node.children) element.append(buildNode(child));
    return element;
  };

  /* ---------------------------------------------------------------- *
   * Style
   * ---------------------------------------------------------------- */

  /**
   * Recomputes and writes the token set.
   *
   * Only ever touches custom properties on `root` — never a node, never an
   * attribute, never a class. That is what makes a style or polish patch a
   * repaint rather than a relayout, and it is asserted in the tests.
   */
  const paintTokens = (): void => {
    const base = resolve(theme);
    if (maxWidth !== null) base['--jit-maxw'] = `${maxWidth}px`;

    let next = base;

    if (polish !== null) {
      const merged = applyPolish(base, polish);
      const report = checkContrast(merged, {
        surfaces: template?.surfaces ?? ['bg', 'surface'],
      });

      if (report.pass) {
        next = merged;
        rejection = null;
        emit({ type: 'polish-applied', interpretedAs: polish.interpretedAs, report });
      } else {
        // Rejected whole. Cherry-picking the passing tokens would paint fg/bg
        // combinations that were never checked together; nudging lightness
        // would paint something agent 4 did not ask for. The base stays and the
        // telemetry says why.
        rejection = { patch: polish, report, at: Date.now() };
        emit({ type: 'polish-rejected', interpretedAs: polish.interpretedAs, report });
        root.dispatchEvent(
          new CustomEvent(POLISH_REJECTED_EVENT, { detail: rejection, bubbles: true }),
        );
      }
    }

    for (const [name, value] of Object.entries(next)) {
      root.style.setProperty(name, value);
    }
    tokens = next;
  };

  /* ---------------------------------------------------------------- *
   * Patches
   * ---------------------------------------------------------------- */

  return {
    applySkeleton(patch) {
      template = TEMPLATES[patch.templateId];
      maxWidth = patch.maxWidth;
      slotElements.clear();
      root.replaceChildren(buildNode(template.tree));
      paintTokens();
      emit({ type: 'skeleton', templateId: patch.templateId });
    },

    applyContent(patch) {
      const slots = Object.keys(patch.slots) as SlotId[];
      for (const slot of slots) {
        const value = patch.slots[slot];
        if (value === undefined) continue;
        content[slot] = value;

        const element = slotElements.get(slot);
        // No element yet means no skeleton yet. Buffered above; drained on build.
        if (!element) continue;

        if (value === null) {
          // Not applicable to this instance — a six-ingredient recipe in a
          // template that reserves eight. Collapse rather than shimmer forever.
          element.hidden = true;
          continue;
        }
        element.hidden = false;
        LEAVES[value.kind].fill(element, value);
      }
      emit({ type: 'content', slots });
    },

    applyStyle(patch) {
      theme = patch.theme;
      themeSource = 'patch';
      paintTokens();
      emit({ type: 'style', theme: patch.theme });
    },

    applyPolish(patch) {
      polish = patch;
      paintTokens();
    },

    getActions() {
      return template === null ? [] : collectActions(template, content);
    },

    getLastRejection: () => rejection,

    getState: () => ({
      templateId: template?.id ?? null,
      themeSource,
      theme,
      content: { ...content },
      polish,
      tokens: tokens === null ? null : { ...tokens },
    }),
  };
}
