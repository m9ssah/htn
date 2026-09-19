import type {
  ActionDescriptor,
  LeafComponent,
  SlotValue,
  ThemeEnums,
} from '@jit/schema';
import { LEAVES, TEMPLATES, createRenderer } from '@jit/renderer';
import { resolve } from '@jit/tokens';
import { SCENARIOS } from '../../../packages/renderer/harness/scenarios.js';
import { createRail } from './rail.js';
import './testbench.css';

const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 480;

document.title = 'JIT UI — Testbench';
document.body.className = 'testbench-body';
document.body.innerHTML = `
  <header class="testbench-header">
    <div>
      <p class="testbench-eyebrow">JIT UI / device preview</p>
      <h1>Testbench</h1>
      <p>Every tab renders inside the Pi's native 800 × 480 viewport.</p>
    </div>
    <a href="/">Open device</a>
  </header>
  <main class="testbench-main">
    <div class="screen-scaler" id="screen-scaler">
      <div class="screen-frame">
        <div class="screen" aria-label="800 by 480 pixel device preview">
          <section class="testbench-display surface" id="testbench-display"></section>
          <footer class="rail" id="testbench-rail"></footer>
          <div class="fader" id="testbench-fader" hidden></div>
        </div>
      </div>
    </div>
    <section class="hardware-deck" aria-label="Device control simulator">
      <div class="hardware-control hardware-slider-control">
        <div class="hardware-heading">
          <span>Physical slider</span>
          <strong id="hardware-slider-value">Not mapped</strong>
        </div>
        <input id="hardware-slider" type="range" min="0" max="1" value="0" disabled />
        <div class="hardware-poles">
          <span id="hardware-slider-min">—</span>
          <span id="hardware-slider-map">No range action on this page</span>
          <span id="hardware-slider-max">—</span>
        </div>
      </div>
      <div class="hardware-control encoder-control">
        <div class="hardware-heading">
          <span>Rotary encoder</span>
          <strong id="encoder-count">0 actions</strong>
        </div>
        <div class="encoder-body">
          <button class="encoder-turn" id="encoder-left" type="button" aria-label="Turn encoder left">−</button>
          <button class="encoder-knob" id="encoder-knob" type="button" aria-label="Press rotary encoder">
            <i></i>
          </button>
          <button class="encoder-turn" id="encoder-right" type="button" aria-label="Turn encoder right">+</button>
          <div class="encoder-readout">
            <b id="encoder-label">Not mapped</b>
            <span id="encoder-map">Select a page action</span>
          </div>
        </div>
      </div>
    </section>
    <nav class="page-tabs" id="page-tabs" role="tablist" aria-label="Preview page"></nav>
  </main>
`;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`testbench: #${id} missing`);
  return element as T;
};

const scaler = $('screen-scaler');
const railHost = $('testbench-rail');
const faderHost = $('testbench-fader');
const hardwareSlider = $<HTMLInputElement>('hardware-slider');
const hardwareSliderValue = $('hardware-slider-value');
const hardwareSliderMin = $('hardware-slider-min');
const hardwareSliderMax = $('hardware-slider-max');
const hardwareSliderMap = $('hardware-slider-map');
const encoderKnob = $<HTMLButtonElement>('encoder-knob');
const encoderLeft = $<HTMLButtonElement>('encoder-left');
const encoderRight = $<HTMLButtonElement>('encoder-right');
const encoderCount = $('encoder-count');
const encoderLabel = $('encoder-label');
const encoderMap = $('encoder-map');
let display = $('testbench-display');
let activeRail: ReturnType<typeof createRail> | null = null;
let activeActions: ActionDescriptor[] = [];
let encoderIndex = 0;
let encoderRotation = -120;

type Tab = {
  id: string;
  label: string;
  description: string;
  render: () => void;
};

const TEMPLATE_LABELS: Record<string, string> = {
  choice_cards: 'Choices',
  item_detail: 'Details',
  focus_step: 'Focus',
  recovery: 'Recovery',
  summary_done: 'Done',
  people_picker: 'People',
  message_drafts: 'Messages',
  generic_answer: 'Answer',
};

const resetScreen = (): void => {
  const next = document.createElement('section');
  next.id = 'testbench-display';
  next.className = 'testbench-display surface';
  display.replaceWith(next);
  display = next;
  railHost.replaceChildren();
  faderHost.replaceChildren();
  faderHost.hidden = true;
  activeRail = null;
};

const renderScenario = (index: number): void => {
  resetScreen();
  const scenario = SCENARIOS[index];
  if (!scenario) return;

  const renderer = createRenderer(display);
  renderer.applySkeleton({
    v: 1,
    templateId: scenario.templateId,
    maxWidth: TEMPLATES[scenario.templateId].maxWidth,
  });
  renderer.applyStyle(scenario.style);
  renderer.applyContent(scenario.content);
  if (scenario.polish) renderer.applyPolish(scenario.polish);

  activeRail = createRail(railHost, faderHost);
  activeRail.update(renderer.getActions());
  mapHardware(renderer.getActions());
};

type PrimitiveOptions = {
  props?: Parameters<(typeof LEAVES)[LeafComponent]['build']>[0];
  className?: string;
  action?: string;
  detail?: boolean;
};

const primitive = (
  kind: LeafComponent,
  value: SlotValue,
  options: PrimitiveOptions = {},
): HTMLElement => {
  const spec = LEAVES[kind];
  const element = spec.build(options.props ?? {});
  element.dataset['slot'] = `primitive.${kind}`;
  if (options.className) element.classList.add(options.className);
  if (options.action) element.dataset['action'] = options.action;
  if (options.detail) element.dataset['hasDetail'] = 'true';
  spec.fill(element, value);
  return element;
};

const section = (title: string, children: HTMLElement[]): HTMLElement => {
  const card = document.createElement('section');
  card.className = 'primitive-card';
  const heading = document.createElement('p');
  heading.className = 'primitive-card-title';
  heading.textContent = title;
  const content = document.createElement('div');
  content.className = 'primitive-card-content';
  content.append(...children);
  card.append(heading, content);
  return card;
};

const renderPrimitives = (): void => {
  resetScreen();
  display.classList.add('jit-root', 'primitives-root');

  const theme: ThemeEnums = {
    palette: 'slate',
    fontPairing: 'system',
    density: 'compact',
    radius: 'soft',
    motif: 'none',
  };
  const tokens = resolve(theme);
  for (const [name, value] of Object.entries(tokens)) {
    display.style.setProperty(name, value);
  }
  display.style.setProperty('--jit-maxw', '760px');

  const typography = section('Typography', [
    primitive('Label', { kind: 'Label', text: 'Section label' }),
    primitive('Heading', { kind: 'Heading', text: 'Display heading' }, { props: { level: 1 } }),
    primitive('Heading', { kind: 'Heading', text: 'Supporting heading' }, { props: { level: 2 } }),
    primitive('Text', { kind: 'Text', text: 'Body copy stays compact, calm, and readable at arm’s length.' }),
    primitive('Text', { kind: 'Text', text: 'Muted copy provides supporting context.' }, { props: { tone: 'muted' } }),
    primitive('Badge', { kind: 'Badge', text: 'Ready' }),
  ]);

  const information = section('Information', [
    primitive('Metric', { kind: 'Metric', label: 'Batch size', value: '30 cookies', delta: '+12 from original' }),
    primitive('ListItem', { kind: 'ListItem', title: 'Chocolate chips', detail: 'Pantry', meta: '2 cups' }, { detail: true, action: 'confirm' }),
    primitive('Rule', { kind: 'Rule', left: 'Estimated total', right: '$12.80' }),
    primitive('Progress', { kind: 'Progress', pct: 64 }),
    primitive('Bars', { kind: 'Bars', values: [34, 68, 48, 88, 62] }),
    primitive('Alert', { kind: 'Alert', text: 'This is an inline alert with a recommended next step.' }),
  ]);

  const controls = section('Controls', [
    primitive('TextField', { kind: 'TextField', label: 'Message', placeholder: 'Type a note…' }),
    primitive('Slider', {
      kind: 'Slider',
      label: 'Intensity',
      min: 0,
      max: 4,
      step: 1,
      value: 2,
      minLabel: 'Soft',
      maxLabel: 'Bold',
    }, { action: 'intensity' }),
    primitive('Toggle', { kind: 'Toggle', label: 'Include substitutions', on: true }),
    primitive('Button', { kind: 'Button', text: 'Primary action' }, { props: { variant: 'primary' }, action: 'choose' }),
    primitive('Button', { kind: 'Button', text: 'Secondary' }, { props: { variant: 'secondary' }, action: 'back' }),
    primitive('Button', { kind: 'Button', text: 'Ghost action' }, { props: { variant: 'ghost' }, action: 'edit' }),
    primitive('Media', { kind: 'Media', caption: 'Media · 16:9' }),
  ]);

  const sheet = document.createElement('div');
  sheet.className = 'primitive-sheet';
  sheet.append(typography, information, controls);
  display.append(sheet);

  const sampleActions: ActionDescriptor[] = [
    { index: 0, action: 'choose', kind: 'press', slot: 'choice_cards.option1', label: 'Choose' },
    { index: 1, action: 'back', kind: 'press', slot: 'focus_step.prev', label: 'Back' },
    { index: 2, action: 'edit', kind: 'press', slot: 'message_drafts.edit', label: 'Edit' },
    { index: 3, action: 'confirm', kind: 'press', slot: 'people_picker.confirm', label: 'Confirm' },
    {
      index: 4,
      action: 'intensity',
      kind: 'range',
      slot: 'choice_cards.axis',
      label: 'Intensity',
      range: {
        min: 0,
        max: 4,
        step: 1,
        value: 2,
        unit: null,
        minLabel: 'Soft',
        maxLabel: 'Bold',
      },
    },
  ];
  activeRail = createRail(railHost, faderHost);
  activeRail.update(sampleActions);
  mapHardware(sampleActions);
};

const pressActions = (): ActionDescriptor[] =>
  activeActions.filter((action) => action.kind !== 'range');

const rangeAction = (): Extract<ActionDescriptor, { kind: 'range' }> | null =>
  activeActions.find((action): action is Extract<ActionDescriptor, { kind: 'range' }> =>
    action.kind === 'range'
  ) ?? null;

const actionTarget = (action: ActionDescriptor): HTMLElement | null =>
  display.querySelector<HTMLElement>(`[data-action="${CSS.escape(action.action)}"]`);

const syncEncoder = (scroll = false): void => {
  for (const element of display.querySelectorAll('.is-encoder-selected')) {
    element.classList.remove('is-encoder-selected');
  }

  const actions = pressActions();
  encoderCount.textContent = `${actions.length} action${actions.length === 1 ? '' : 's'}`;
  encoderKnob.disabled = actions.length === 0;
  encoderLeft.disabled = actions.length === 0;
  encoderRight.disabled = actions.length === 0;

  if (actions.length === 0) {
    encoderLabel.textContent = 'Not mapped';
    encoderMap.textContent = 'No press action on this page';
    return;
  }

  encoderIndex = ((encoderIndex % actions.length) + actions.length) % actions.length;
  const action = actions[encoderIndex]!;
  encoderLabel.textContent = action.label ?? 'Pending label';
  encoderMap.textContent = `${action.action} · position ${encoderIndex + 1} of ${actions.length}`;
  const target = actionTarget(action);
  target?.classList.add('is-encoder-selected');
  if (scroll) target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

const syncHardwareSlider = (): void => {
  const action = rangeAction();
  const range = action?.range;
  hardwareSlider.disabled = range === null || range === undefined;

  if (!action || !range) {
    hardwareSlider.min = '0';
    hardwareSlider.max = '1';
    hardwareSlider.step = '1';
    hardwareSlider.value = '0';
    hardwareSliderValue.textContent = 'Not mapped';
    hardwareSliderMin.textContent = '—';
    hardwareSliderMax.textContent = '—';
    hardwareSliderMap.textContent = 'No range action on this page';
    return;
  }

  hardwareSlider.min = String(range.min);
  hardwareSlider.max = String(range.max);
  hardwareSlider.step = String(range.step);
  hardwareSlider.value = String(range.value);
  hardwareSliderValue.textContent = range.unit ? `${range.value} ${range.unit}` : String(range.value);
  hardwareSliderMin.textContent = range.minLabel ?? String(range.min);
  hardwareSliderMax.textContent = range.maxLabel ?? String(range.max);
  hardwareSliderMap.textContent = `${action.label ?? 'Range'} → ${action.action}`;
};

function mapHardware(actions: ActionDescriptor[]): void {
  activeActions = actions;
  encoderIndex = 0;
  encoderRotation = -120;
  encoderKnob.style.setProperty('--encoder-angle', `${encoderRotation}deg`);
  syncEncoder();
  syncHardwareSlider();
}

const turnEncoder = (direction: -1 | 1): void => {
  if (pressActions().length === 0) return;
  encoderIndex += direction;
  encoderRotation += direction * 32;
  encoderKnob.style.setProperty('--encoder-angle', `${encoderRotation}deg`);
  syncEncoder(true);
};

const pressEncoder = (): void => {
  const action = pressActions()[encoderIndex];
  if (!action) return;
  const target = actionTarget(action);
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  target?.classList.add('is-encoder-pressed');
  window.setTimeout(() => target?.classList.remove('is-encoder-pressed'), 180);
  encoderMap.textContent = `Pressed ${action.action}`;
};

encoderLeft.addEventListener('click', () => turnEncoder(-1));
encoderRight.addEventListener('click', () => turnEncoder(1));
encoderKnob.addEventListener('click', pressEncoder);
encoderKnob.addEventListener('wheel', (event) => {
  event.preventDefault();
  turnEncoder(event.deltaY > 0 ? 1 : -1);
}, { passive: false });
encoderKnob.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  turnEncoder(event.key === 'ArrowRight' ? 1 : -1);
});

let pointerId: number | null = null;
let pointerX = 0;
let pointerMoved = false;
encoderKnob.addEventListener('pointerdown', (event) => {
  pointerId = event.pointerId;
  pointerX = event.clientX;
  pointerMoved = false;
  encoderKnob.setPointerCapture(event.pointerId);
});
encoderKnob.addEventListener('pointermove', (event) => {
  if (pointerId !== event.pointerId) return;
  const delta = event.clientX - pointerX;
  if (Math.abs(delta) < 14) return;
  pointerMoved = true;
  turnEncoder(delta > 0 ? 1 : -1);
  pointerX = event.clientX;
});
encoderKnob.addEventListener('pointerup', (event) => {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  if (pointerMoved) {
    const suppressClick = (click: MouseEvent): void => {
      click.stopImmediatePropagation();
      encoderKnob.removeEventListener('click', suppressClick, true);
    };
    encoderKnob.addEventListener('click', suppressClick, true);
  }
});

hardwareSlider.addEventListener('input', () => {
  const action = rangeAction();
  if (!action?.range) return;
  action.range.value = Number(hardwareSlider.value);
  hardwareSliderValue.textContent = action.range.unit
    ? `${hardwareSlider.value} ${action.range.unit}`
    : hardwareSlider.value;

  const target = actionTarget(action);
  const input = target?.querySelector<HTMLInputElement>('.s-input');
  if (input) {
    input.value = hardwareSlider.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const value = target?.querySelector<HTMLElement>('.s-value');
  if (value) {
    value.textContent = action.range.unit
      ? `${hardwareSlider.value} ${action.range.unit}`
      : '';
  }
  activeRail?.update(activeActions);
});

const tabs: Tab[] = [
  {
    id: 'primitives',
    label: 'Primitives',
    description: 'Design-system primitives',
    render: renderPrimitives,
  },
  ...SCENARIOS.map((scenario, index) => ({
    id: scenario.templateId,
    label: TEMPLATE_LABELS[scenario.templateId] ?? scenario.templateId,
    description: scenario.intent,
    render: () => renderScenario(index),
  })),
];

const tabHost = $('page-tabs');
let active = new URLSearchParams(window.location.search).get('tab') ?? 'primitives';
if (!tabs.some((tab) => tab.id === active)) active = 'primitives';

const selectTab = (id: string): void => {
  const tab = tabs.find((candidate) => candidate.id === id) ?? tabs[0]!;
  active = tab.id;
  for (const button of tabHost.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const selected = button.dataset['tab'] === active;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  tab.render();
  const url = new URL(window.location.href);
  url.searchParams.set('tab', active);
  window.history.replaceState({}, '', url);
};

for (const tab of tabs) {
  const button = document.createElement('button');
  button.type = 'button';
  button.role = 'tab';
  button.dataset['tab'] = tab.id;
  button.title = tab.description;
  button.textContent = tab.label;
  button.addEventListener('click', () => selectTab(tab.id));
  tabHost.append(button);
}

tabHost.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const current = tabs.findIndex((tab) => tab.id === active);
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  const next = (current + direction + tabs.length) % tabs.length;
  selectTab(tabs[next]!.id);
  tabHost.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next]!.id}"]`)?.focus();
});

const fitScreen = (): void => {
  const available = Math.max(280, Math.min(SCREEN_WIDTH, scaler.parentElement?.clientWidth ?? window.innerWidth - 40));
  const scale = available / SCREEN_WIDTH;
  scaler.style.setProperty('--screen-scale', String(scale));
  scaler.style.width = `${SCREEN_WIDTH * scale}px`;
  scaler.style.height = `${SCREEN_HEIGHT * scale}px`;
};

window.addEventListener('resize', fitScreen);
fitScreen();
selectTab(active);
