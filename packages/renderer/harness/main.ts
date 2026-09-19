import '@jit/renderer/renderer.css';
import type { ContrastReport, Density, FontPairing, Motif, Palette, Radius, ThemeEnums } from '@jit/schema';
import { DENSITIES, FONTS, MOTIFS, PALETTES, RADII, checkContrast } from '@jit/tokens';
import {
  POLISH_REJECTED_EVENT,
  TEMPLATES,
  createRenderer,
  type TelemetryEvent,
} from '@jit/renderer';
import { SCENARIOS, UNREADABLE_POLISH, type Scenario } from './scenarios.js';

type PatchName = 'skeleton' | 'content' | 'style' | 'polish';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`harness: #${id} missing`);
  return el as T;
};

const surface = $('surface');
const log: { at: string; text: string; bad: boolean }[] = [];

const renderer = createRenderer(surface, {
  onTelemetry: (event) => {
    log.unshift({
      at: new Date().toLocaleTimeString([], { hour12: false }),
      text: describe(event),
      bad: event.type === 'polish-rejected',
    });
    refresh();
  },
});

function describe(event: TelemetryEvent): string {
  switch (event.type) {
    case 'skeleton':
      return `skeleton  ${event.templateId}`;
    case 'content':
      return `content   ${event.slots.length} slot${event.slots.length === 1 ? '' : 's'}`;
    case 'style':
      return `style     ${Object.values(event.theme).join(' / ')}`;
    case 'polish-applied':
      return `polish    applied — "${event.interpretedAs}"`;
    case 'polish-rejected': {
      const failed = event.report.checks.filter((c) => !c.pass).map((c) => c.pair);
      return `polish    REJECTED (${failed.join(', ')}) — "${event.interpretedAs}"`;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Scenario + axis controls
 * ------------------------------------------------------------------ */

const scenarioSelect = $<HTMLSelectElement>('scenario');
scenarioSelect.append(
  ...SCENARIOS.map((s, i) => new Option(`“${s.intent}”`, String(i))),
);

const current = (): Scenario => SCENARIOS[Number(scenarioSelect.value)] ?? SCENARIOS[0]!;

/** Axis state, edited directly so "Restyle" is decoupled from the scenario. */
let theme: ThemeEnums = { ...current().style.theme };

const AXES = [
  { key: 'palette', label: 'palette', values: Object.keys(PALETTES) as Palette[] },
  { key: 'fontPairing', label: 'font pairing', values: Object.keys(FONTS) as FontPairing[] },
  { key: 'density', label: 'density', values: Object.keys(DENSITIES) as Density[] },
  { key: 'radius', label: 'radius', values: Object.keys(RADII) as Radius[] },
  { key: 'motif', label: 'motif', values: Object.keys(MOTIFS) as Motif[] },
] as const;

const axisSelects = new Map<keyof ThemeEnums, HTMLSelectElement>();

for (const axis of AXES) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = axis.label;
  const select = document.createElement('select');
  select.append(...axis.values.map((v) => new Option(v, v)));
  select.addEventListener('change', () => {
    theme = { ...theme, [axis.key]: select.value } as ThemeEnums;
    fire('style');
  });
  wrap.append(caption, select);
  $('axes').append(wrap);
  axisSelects.set(axis.key, select);
}

const syncAxes = (): void => {
  for (const [key, select] of axisSelects) select.value = theme[key];
};

/* ------------------------------------------------------------------ *
 * Firing patches
 * ------------------------------------------------------------------ */

const fired = new Set<PatchName>();
let rejected = false;

function fire(name: PatchName): void {
  const scenario = current();
  switch (name) {
    case 'skeleton':
      renderer.applySkeleton({
        v: 1,
        templateId: scenario.templateId,
        maxWidth: TEMPLATES[scenario.templateId].maxWidth,
      });
      break;
    case 'content':
      renderer.applyContent(scenario.content);
      break;
    case 'style':
      renderer.applyStyle({ v: 1, theme });
      break;
    case 'polish':
      if (!scenario.polish) return;
      renderer.applyPolish(scenario.polish);
      break;
  }
  fired.add(name);
  refresh();
}

function reset(): void {
  fired.clear();
  rejected = false;
  log.length = 0;
  surface.replaceChildren();
  surface.removeAttribute('style');
  theme = { ...current().style.theme };
  syncAxes();
  refresh();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fire]')) {
  button.addEventListener('click', () => fire(button.dataset['fire'] as PatchName));
}

$('shuffle').addEventListener('click', () => {
  reset();
  const order: PatchName[] = ['skeleton', 'content', 'style', 'polish'];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  log.unshift({ at: '', text: `shuffled order: ${order.join(' → ')}`, bad: false });
  for (const name of order) fire(name);
});

/** Production timings from the latency budget, so the staging is watchable. */
$('staged').addEventListener('click', () => {
  reset();
  const at = (ms: number, name: PatchName): number => window.setTimeout(() => fire(name), ms);
  at(170, 'skeleton');
  at(640, 'content');
  at(900, 'style');
  at(1900, 'polish');
});

$('unreadable').addEventListener('click', () => {
  if (!fired.has('skeleton')) fire('skeleton');
  renderer.applyPolish(UNREADABLE_POLISH);
  fired.add('polish');
  refresh();
});

$('reset').addEventListener('click', reset);

scenarioSelect.addEventListener('change', reset);

surface.addEventListener(POLISH_REJECTED_EVENT, () => {
  rejected = true;
  refresh();
});

/* ------------------------------------------------------------------ *
 * Inspector
 * ------------------------------------------------------------------ */

let tab = 'actions';
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.addEventListener('click', () => {
    tab = button.dataset['tab']!;
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      other.setAttribute('aria-selected', String(other === button));
    }
    refresh();
  });
}

const row = (cells: (string | Node)[], tag: 'td' | 'th' = 'td'): HTMLTableRowElement => {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const el = document.createElement(tag);
    if (typeof cell === 'string') el.textContent = cell;
    else el.append(cell);
    tr.append(el);
  }
  return tr;
};

const table = (headers: string[], rows: (string | Node)[][]): HTMLElement => {
  const el = document.createElement('table');
  const head = document.createElement('thead');
  head.append(row(headers, 'th'));
  const body = document.createElement('tbody');
  body.append(...rows.map((r) => row(r)));
  el.append(head, body);
  return el;
};

const empty = (text: string): HTMLElement => {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
};

function renderActions(): Node {
  const actions = renderer.getActions();
  if (actions.length === 0) {
    return empty(
      fired.has('skeleton')
        ? 'This template exposes no actions. On the device its four buttons stay dark.'
        : 'No skeleton yet. getActions() returns [].',
    );
  }
  const node = table(
    ['btn', 'action', 'kind', 'slot', 'label'],
    actions.map((a) => [
      `${a.index + 1}`,
      a.action,
      a.kind,
      a.slot,
      a.label ?? '— (no content yet)',
    ]),
  );
  const wrap = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `${actions.length} of 4 physical buttons mapped, in DOM order.`;
  wrap.append(node, note);
  return wrap;
}

function renderContrast(): Node {
  const state = renderer.getState();
  if (!state.tokens) return empty('Nothing painted yet.');

  const surfaces = state.templateId ? TEMPLATES[state.templateId].surfaces : undefined;
  const report: ContrastReport = checkContrast(
    state.tokens,
    surfaces ? { surfaces } : {},
  );
  const wrap = document.createElement('div');

  const rejection = renderer.getLastRejection();
  if (rejection) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    const failed = rejection.report.checks.filter((c) => !c.pass);
    banner.innerHTML =
      `<b>Polish rejected.</b> “${rejection.patch.interpretedAs}” failed ` +
      `${failed.length} pair${failed.length === 1 ? '' : 's'}. The enum base is still on screen — ` +
      'the patch was refused whole rather than partly applied, so what you see is exactly ' +
      'what was validated.';
    wrap.append(banner);
  }

  wrap.append(
    table(
      ['pair', 'ratio', 'needs', ''],
      report.checks.map((c) => {
        const verdict = document.createElement('span');
        verdict.className = c.pass ? 'pass' : 'fail';
        verdict.textContent = c.pass ? 'PASS' : (c.reason ?? 'FAIL');
        return [c.pair, c.ratio === null ? '—' : `${c.ratio}:1`, `${c.required}:1`, verdict];
      }),
    ),
  );

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = surfaces
    ? `Required pairs narrowed to the grounds ${state.templateId} paints on: ${surfaces.join(', ')}.`
    : 'All five pairs required.';
  wrap.append(note);
  return wrap;
}

function renderTokens(): Node {
  const { tokens } = renderer.getState();
  if (!tokens) return empty('Nothing painted yet.');

  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  for (const [name, value] of Object.entries(tokens)) {
    const item = document.createElement('div');
    item.className = 'swatch';
    const chip = document.createElement('i');
    if (/^#|^rgb/.test(value)) chip.style.background = value;
    else chip.style.background = 'transparent';
    const text = document.createElement('div');
    const key = document.createElement('code');
    key.textContent = name;
    const val = document.createElement('code');
    val.textContent = value;
    text.append(key, val);
    item.append(chip, text);
    wrap.append(item);
  }
  return wrap;
}

function renderTelemetry(): Node {
  if (log.length === 0) return empty('Nothing fired yet.');
  const wrap = document.createElement('div');
  wrap.className = 'log';
  for (const entry of log) {
    const line = document.createElement('div');
    if (entry.bad) line.className = 'rejected';
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = entry.at ? `${entry.at}  ` : '';
    line.append(time, document.createTextNode(entry.text));
    wrap.append(line);
  }
  return wrap;
}

function refresh(): void {
  const scenario = current();
  $('scenario-template').textContent =
    `template: ${scenario.templateId} · ${TEMPLATES[scenario.templateId].maxWidth}px · ` +
    `paints on ${TEMPLATES[scenario.templateId].surfaces.join(' + ')}`;

  const pipeline = $('pipeline');
  pipeline.replaceChildren(
    ...(['skeleton', 'content', 'style', 'polish'] as PatchName[]).map((name) => {
      const chip = document.createElement('span');
      chip.textContent = name;
      const on = fired.has(name);
      chip.dataset['on'] = name === 'polish' && rejected && on ? 'rejected' : String(on);
      return chip;
    }),
  );

  for (const name of ['actions', 'contrast', 'tokens', 'telemetry']) {
    $(`panel-${name}`).hidden = name !== tab;
  }

  const body =
    tab === 'actions'
      ? renderActions()
      : tab === 'contrast'
        ? renderContrast()
        : tab === 'tokens'
          ? renderTokens()
          : renderTelemetry();
  $(`panel-${tab}`).replaceChildren(body);

  syncAxes();
}

/* ------------------------------------------------------------------ *
 * Deep links
 *
 * ?s=<scenario index>&fire=skeleton,content,style,polish (or `all`, `staged`,
 * `unreadable`). Makes a particular surface reproducible from a URL, which is
 * how you hand someone a bug rather than a list of clicks.
 * ------------------------------------------------------------------ */

function applyDeepLink(): void {
  const params = new URLSearchParams(window.location.search);

  const index = Number(params.get('s'));
  if (Number.isInteger(index) && index >= 0 && index < SCENARIOS.length) {
    scenarioSelect.value = String(index);
  }
  reset();

  const fire_ = params.get('fire');
  if (!fire_) return;
  if (fire_ === 'staged') {
    $('staged').click();
    return;
  }
  if (fire_ === 'unreadable') {
    $('unreadable').click();
    return;
  }
  const names: PatchName[] =
    fire_ === 'all'
      ? ['skeleton', 'content', 'style', 'polish']
      : (fire_.split(',').filter((n) => n) as PatchName[]);
  for (const name of names) fire(name);
}

applyDeepLink();
