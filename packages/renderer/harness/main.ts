import '@jit/renderer/renderer.css';
import type { PolishPatch } from '@jit/schema';
import { EXAMPLES, createJsonRenderer, toLegacyActions, type JsonSurfaceRenderer } from '@jit/renderer';
import './harness.css';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`harness: #${id} missing`);
  return element as T;
};

const surface = $('surface');
const select = $<HTMLSelectElement>('scenario');
const pipeline = $('pipeline');
const actionsPanel = $('panel-actions');
const contrastPanel = $('panel-contrast');
const tokensPanel = $('panel-tokens');
const telemetryPanel = $('panel-telemetry');
const exampleHint = $('scenario-template');
let renderer: JsonSurfaceRenderer;
let fired = new Set<string>();
let telemetry: string[] = [];

const unreadable: PolishPatch = {
  v: 1,
  interpretedAs: 'moody, low contrast, barely there',
  tokens: { '--jit-bg': '#3a3a3a', '--jit-surface': '#404040', '--jit-fg': '#4e4e4e', '--jit-muted': '#484848', '--jit-accent': '#555555', '--jit-on-accent': '#606060' },
};

for (const [index, example] of EXAMPLES.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = example.intent;
  select.append(option);
}

const current = () => EXAMPLES[Number(select.value)] ?? EXAMPLES[0]!;

function showPipeline() {
  pipeline.replaceChildren(...['structure', 'content', 'style', 'polish'].map((stage) => {
    const node = document.createElement('span');
    node.textContent = `${fired.has(stage) ? '✓' : '○'} ${stage}`;
    node.dataset['done'] = String(fired.has(stage));
    return node;
  }));
}

function inspect() {
  const state = renderer.getState();
  const actions = toLegacyActions(renderer.getActions());
  actionsPanel.textContent = actions.length === 0 ? 'No hardware actions yet.' : actions.map((action) => `${action.index + 1}. ${action.kind} · ${action.label ?? 'pending'} · ${action.action}`).join('\n');
  const rejection = renderer.getLastRejection();
  contrastPanel.textContent = rejection ? `Rejected: ${rejection.report.checks.map((check) => `${check.pair} ${check.ratio ?? 'invalid'}`).join(', ')}` : 'Current token set passes active-surface contrast checks.';
  tokensPanel.textContent = state.tokens ? Object.entries(state.tokens).map(([name, value]) => `${name}: ${value}`).join('\n') : 'No tokens painted yet.';
  telemetryPanel.textContent = telemetry.join('\n') || 'No updates yet.';
}

function reset() {
  renderer?.destroy();
  surface.replaceChildren();
  renderer = createJsonRenderer(surface, { onTelemetry: (event) => { telemetry.push(event.type); inspect(); } });
  fired = new Set();
  telemetry = [];
  exampleHint.textContent = `example: ${current().id} · flat json-render Spec`;
  showPipeline();
  inspect();
}

function fire(stage: 'structure' | 'content' | 'style' | 'polish') {
  const example = current();
  const update = stage === 'structure' ? example.structure : stage === 'content' ? example.content : stage === 'style' ? example.style : example.polish;
  if (update) renderer.apply(update);
  fired.add(stage);
  showPipeline();
  inspect();
}

function fireAll(order: Array<'structure' | 'content' | 'style' | 'polish'>) {
  for (const stage of order) fire(stage);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fire]')) {
  button.addEventListener('click', () => fire(button.dataset['fire'] === 'skeleton' ? 'structure' : button.dataset['fire'] as 'content' | 'style' | 'polish'));
}
$('shuffle').addEventListener('click', () => fireAll(['polish', 'content', 'style', 'structure']));
$('staged').addEventListener('click', () => fireAll(['structure', 'style', 'content', 'polish']));
$('reset').addEventListener('click', reset);
$('unreadable').addEventListener('click', () => { renderer.apply(unreadable); fired.add('polish'); showPipeline(); inspect(); });
select.addEventListener('change', reset);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) other.setAttribute('aria-selected', String(other === button));
    for (const panel of [actionsPanel, contrastPanel, tokensPanel, telemetryPanel]) panel.hidden = panel.id !== `panel-${button.dataset['tab']}`;
  });
}

reset();
