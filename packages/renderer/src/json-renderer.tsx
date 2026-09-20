import { createStateStore, type Spec } from '@json-render/core';
import { JSONUIProvider, Renderer as JsonRenderer } from '@json-render/react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ActionDescriptor,
  ContentUpdateV2,
  ContrastReport,
  PolishPatch,
  StylePatch,
  SurfaceActionDescriptor,
  SurfaceSpec,
  SurfaceUpdate,
  ThemeEnums,
  TokenSet,
} from '@jit/schema';
import { BUTTON_COUNT_V2, RANGE_CONTROL_COUNT_V2, SurfaceSpecSchema } from '@jit/schema';
import { applyPolish, checkContrast, resolve } from '@jit/tokens';
import { JIT_REGISTRY } from './catalog.js';

export const BOOTSTRAP_THEME: ThemeEnums = {
  palette: 'slate', fontPairing: 'system', density: 'normal', radius: 'soft', motif: 'none',
};

export type ApplyResult = { ok: true } | { ok: false; reason: string };
export type JsonRendererState = {
  generationId: string | null;
  spec: SurfaceSpec | null;
  theme: ThemeEnums;
  themeSource: 'bootstrap' | 'patch';
  polish: PolishPatch | null;
  tokens: TokenSet | null;
};
export type JsonRendererOptions = {
  onTelemetry?: (event: { type: string; detail?: Record<string, unknown> }) => void;
  transitions?: boolean;
};
export type JsonSurfaceRenderer = {
  apply: (update: SurfaceUpdate) => ApplyResult;
  getActions: () => SurfaceActionDescriptor[];
  getState: () => JsonRendererState;
  getLastRejection: () => { patch: PolishPatch; report: ContrastReport; at: number } | null;
  destroy: () => void;
};

function App({ spec, store }: { spec: SurfaceSpec | null; store: ReturnType<typeof createStateStore> }) {
  return <JSONUIProvider registry={JIT_REGISTRY} store={store}><JsonRenderer spec={spec as Spec | null} registry={JIT_REGISTRY} /></JSONUIProvider>;
}

function isExpression(value: unknown): value is { $state: string } | { $bindState: string } {
  return !!value && typeof value === 'object' && (('$state' in value && typeof value.$state === 'string') || ('$bindState' in value && typeof value.$bindState === 'string'));
}

function resolveValue(value: unknown, store: ReturnType<typeof createStateStore>): unknown {
  if (!isExpression(value)) return value;
  return store.get('$state' in value ? value.$state : value.$bindState);
}

function surfaces(spec: SurfaceSpec | null): Array<'bg' | 'surface' | 'accent-soft'> {
  if (!spec) return ['bg', 'surface'];
  const types = Object.values(spec.elements).map((element) => element.type);
  return [
    'surface',
    ...(types.some((type) => type === 'Badge' || type === 'Alert') ? ['accent-soft' as const] : []),
  ];
}

function validateSpec(spec: SurfaceSpec): string | null {
  const parsed = SurfaceSpecSchema.safeParse(spec);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid surface spec.';
  if (!spec.elements[spec.root]) return 'The root element is missing.';
  if (Object.keys(spec.elements).length > 24) return 'The device accepts at most 24 elements.';
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): string | null => {
    if (depth > 4) return 'The device accepts a maximum tree depth of four.';
    if (visiting.has(id)) return 'The surface spec contains a cycle.';
    const element = spec.elements[id];
    if (!element) return `Missing child element: ${id}.`;
    if (seen.has(id)) return null;
    seen.add(id); visiting.add(id);
    for (const child of element.children ?? []) {
      const error = visit(child, depth + 1);
      if (error) return error;
    }
    visiting.delete(id);
    return null;
  };
  const error = visit(spec.root, 1);
  if (error) return error;
  if (seen.size !== Object.keys(spec.elements).length) return 'The surface spec contains unreachable elements.';
  return null;
}

function stateUpdates(spec: SurfaceSpec): Record<string, unknown> {
  const content = (spec.state?.content ?? {}) as Record<string, unknown>;
  return { '/content': content };
}

function actionKind(type: string): SurfaceActionDescriptor['kind'] | null {
  if (type === 'Button' || type === 'ListItem') return 'press';
  if (type === 'Toggle') return 'toggle';
  if (type === 'TextField') return 'text';
  if (type === 'Slider') return 'range';
  return null;
}

function actionLabel(type: string, props: Record<string, unknown>): string | null {
  if (type === 'ListItem') return typeof props.title === 'string' ? props.title : null;
  if (type === 'TextField' || type === 'Toggle' || type === 'Slider') return typeof props.label === 'string' ? props.label : null;
  if (type === 'Button') return typeof props.text === 'string' ? props.text : null;
  return null;
}

/** The only imperative surface callers need; React/json-render remain internal. */
export function createJsonRenderer(rootElement: HTMLElement, options: JsonRendererOptions = {}): JsonSurfaceRenderer {
  let root: Root | null = createRoot(rootElement);
  const store = createStateStore({ content: {} });
  let spec: SurfaceSpec | null = null;
  let generationId: string | null = null;
  let maxWidth: number | null = null;
  let theme = BOOTSTRAP_THEME;
  let themeSource: 'bootstrap' | 'patch' = 'bootstrap';
  let polish: PolishPatch | null = null;
  let tokens: TokenSet | null = null;
  let rejection: { patch: PolishPatch; report: ContrastReport; at: number } | null = null;
  const bufferedContent: ContentUpdateV2[] = [];

  rootElement.classList.add('jit-root');

  const render = () => root?.render(<App spec={spec} store={store} />);
  const paintTokens = () => {
    const base = resolve(theme);
    if (maxWidth !== null) base['--jit-maxw'] = `${maxWidth}px`;
    let next = base;
    if (polish) {
      const candidate = applyPolish(base, polish);
      const report = checkContrast(candidate, { surfaces: surfaces(spec) });
      if (report.pass) {
        next = candidate;
        rejection = null;
        options.onTelemetry?.({ type: 'polish-applied', detail: { interpretedAs: polish.interpretedAs } });
      } else {
        rejection = { patch: polish, report, at: Date.now() };
        options.onTelemetry?.({ type: 'polish-rejected', detail: { interpretedAs: polish.interpretedAs } });
        rootElement.dispatchEvent(new CustomEvent('jit:polish-rejected', { detail: rejection, bubbles: true }));
      }
    }
    for (const [name, value] of Object.entries(next)) rootElement.style.setProperty(name, value);
    tokens = next;
  };

  const applyContent = (update: ContentUpdateV2): ApplyResult => {
    if (!spec || generationId === null) {
      bufferedContent.push(update);
      return { ok: true };
    }
    if (generationId !== update.generationId) return { ok: false, reason: 'Content belongs to a different generation.' };
    const updates: Record<string, unknown> = {};
    for (const [elementId, fields] of Object.entries(update.values)) {
      const element = spec.elements[elementId];
      if (!element) return { ok: false, reason: `Unknown content element: ${elementId}.` };
      for (const [field, value] of Object.entries(fields)) updates[`/content/${elementId}/${field}`] = value;
      updates[`/content/${elementId}/pending`] = false;
    }
    store.update(updates);
    options.onTelemetry?.({ type: 'content', detail: { complete: update.complete } });
    return { ok: true };
  };

  const apply = (update: SurfaceUpdate): ApplyResult => {
    if ('stage' in update && update.stage === 'structure') {
      const error = validateSpec(update.spec);
      if (error) return { ok: false, reason: error };
      spec = update.spec;
      generationId = update.generationId;
      maxWidth = update.maxWidth;
      store.update(stateUpdates(spec));
      paintTokens();
      render();
      for (const content of bufferedContent.splice(0)) {
        const result = applyContent(content);
        if (!result.ok) return result;
      }
      options.onTelemetry?.({ type: 'structure', detail: { status: update.status } });
      return { ok: true };
    }
    if ('stage' in update && update.stage === 'content') {
      return applyContent(update);
    }
    if ('theme' in update) {
      theme = update.theme;
      themeSource = 'patch';
      paintTokens();
      options.onTelemetry?.({ type: 'style' });
      return { ok: true };
    }
    if ('tokens' in update) {
      polish = update;
      paintTokens();
      return { ok: true };
    }
    return { ok: false, reason: 'Unknown surface update.' };
  };

  return {
    apply,
    getActions() {
      if (!spec) return [];
      const actions: SurfaceActionDescriptor[] = [];
      const visit = (id: string) => {
        const element = spec!.elements[id]!;
        const kind = actionKind(element.type);
        const binding = kind ? element.on?.[kind === 'press' ? 'press' : kind] : undefined;
        if (kind && binding) {
          const props = Object.fromEntries(Object.entries(element.props).map(([name, value]) => [name, resolveValue(value, store)]));
          actions.push({
            index: actions.length,
            action: binding.action,
            elementId: id,
            kind,
            label: actionLabel(element.type, props),
            range: kind === 'range' ? { min: Number(props.min), max: Number(props.max), step: Number(props.step), value: Number(props.value), unit: typeof props.unit === 'string' ? props.unit : null, minLabel: typeof props.minLabel === 'string' ? props.minLabel : null, maxLabel: typeof props.maxLabel === 'string' ? props.maxLabel : null } : null,
          });
        }
        for (const child of element.children ?? []) visit(child);
      };
      visit(spec.root);
      if (actions.filter((action) => action.kind === 'press' || action.kind === 'toggle' || action.kind === 'text').length > BUTTON_COUNT_V2) return [];
      if (actions.filter((action) => action.kind === 'range').length > RANGE_CONTROL_COUNT_V2) return [];
      return actions;
    },
    getState: () => ({ generationId, spec, theme, themeSource, polish, tokens }),
    getLastRejection: () => rejection,
    destroy: () => { root?.unmount(); root = null; },
  };
}

/** Compatibility helper for consumers which only need the old rail descriptor shape. */
export const toLegacyActions = (actions: SurfaceActionDescriptor[]): ActionDescriptor[] => actions.map((action) => ({
  index: action.index,
  action: action.action,
  slot: action.elementId as ActionDescriptor['slot'],
  label: action.label,
  kind: action.kind,
  ...(action.kind === 'range' ? { range: action.range } : action.kind === 'toggle' ? { on: null } : {}),
}) as ActionDescriptor);
