import type {
  ActionDescriptor,
} from '@jit/schema';
import { EXAMPLES, PRIMITIVE_GALLERY_EXAMPLE, STUDY_SESSION_EXAMPLE, createJsonRenderer, toLegacyActions } from '@jit/renderer';
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
let activeRenderer: ReturnType<typeof createJsonRenderer> | null = null;
let activeActions: ActionDescriptor[] = [];
let encoderIndex = 0;
let encoderRotation = -120;

type Tab = {
  id: string;
  label: string;
  description: string;
  render: () => void;
};

const resetScreen = (): void => {
  activeRenderer?.destroy();
  const next = document.createElement('section');
  next.id = 'testbench-display';
  next.className = 'testbench-display surface';
  display.replaceWith(next);
  display = next;
  railHost.replaceChildren();
  faderHost.replaceChildren();
  faderHost.hidden = true;
  activeRail = null;
  activeRenderer = null;
};

const renderScenario = (index: number): void => {
  resetScreen();
  const scenario = EXAMPLES[index];
  if (!scenario) return;

  const renderer = createJsonRenderer(display);
  activeRenderer = renderer;
  renderer.apply(scenario.structure);
  renderer.apply(scenario.style);
  renderer.apply(scenario.content);
  if (scenario.polish) renderer.apply(scenario.polish);

  const actions = toLegacyActions(renderer.getActions());
  activeRail = createRail(railHost, faderHost);
  activeRail.update(actions);
  mapHardware(actions);
};

const renderPrimitives = (): void => {
  resetScreen();
  display.classList.add('primitives-root');
  const renderer = createJsonRenderer(display);
  activeRenderer = renderer;
  renderer.apply(PRIMITIVE_GALLERY_EXAMPLE.structure);
  renderer.apply(PRIMITIVE_GALLERY_EXAMPLE.style);
  renderer.apply(PRIMITIVE_GALLERY_EXAMPLE.content);
  const actions = toLegacyActions(renderer.getActions());
  activeRail = createRail(railHost, faderHost);
  activeRail.update(actions);
  mapHardware(actions);
};

const renderExample = (example: typeof STUDY_SESSION_EXAMPLE): void => {
  resetScreen();
  const renderer = createJsonRenderer(display);
  activeRenderer = renderer;
  renderer.apply(example.structure);
  renderer.apply(example.style);
  renderer.apply(example.content);
  if (example.polish) renderer.apply(example.polish);
  const actions = toLegacyActions(renderer.getActions());
  activeRail = createRail(railHost, faderHost);
  activeRail.update(actions);
  mapHardware(actions);
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
  ...EXAMPLES.map((scenario, index) => ({
    id: scenario.id,
    label: scenario.id.replace(/-/g, ' '),
    description: scenario.intent,
    render: () => renderScenario(index),
  })),
  {
    id: STUDY_SESSION_EXAMPLE.id,
    label: 'study session',
    description: STUDY_SESSION_EXAMPLE.intent,
    render: () => renderExample(STUDY_SESSION_EXAMPLE),
  },
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
