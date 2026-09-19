import { createRenderer, TEMPLATES, type Renderer } from '@jit/renderer';
import { createEmoticon, type Mood } from './emoticon.js';
import { createRail } from './rail.js';
import { DEMO, HOME_TILES } from './script.js';

/**
 * The device shell.
 *
 * Owns everything that is not a generated surface: the face, the home, the
 * control rail. It knows nothing about recipes — it moves between three states
 * and forwards control events.
 *
 * Until `apps/server` and `apps/bridge` exist this drives itself from a scripted
 * sequence and a keyboard, so the whole flow is walkable today. Both stand-ins
 * are isolated behind `advance()` and the key handler; swapping in a websocket
 * touches nothing else.
 */

type ShellState = 'greeting' | 'home' | 'surface';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`shell: #${id} missing`);
  return el as T;
};

const shell = $('shell');
const surface = $('surface');
const rail = createRail($('rail'), $('fader'));
const renderer: Renderer = createRenderer(surface, { transitions: true });

const LAYERS: readonly (readonly [HTMLElement, ShellState])[] = [
  [$('greeting'), 'greeting'],
  [$('home'), 'home'],
  [surface, 'surface'],
];

const setState = (state: ShellState): void => {
  shell.dataset['state'] = state;
  for (const [layer, id] of LAYERS) {
    layer.setAttribute('aria-hidden', String(id !== state));
  }
};

/* ------------------------------------------------------------------ *
 * Greeting
 * ------------------------------------------------------------------ */

const greeting = $('greeting');
const faceHost = document.createElement('div');
const word = document.createElement('p');
word.className = 'greeting-word';
word.textContent = 'What do you want to do?';
greeting.append(faceHost, word);
const face = createEmoticon(faceHost);

/* ------------------------------------------------------------------ *
 * Home
 * ------------------------------------------------------------------ */

function paintHome(): void {
  const head = document.createElement('p');
  head.className = 'home-head';
  head.textContent = 'Ready';

  const ask = document.createElement('h1');
  ask.className = 'home-ask';
  ask.textContent = 'What do you\nwant to do?';

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  HOME_TILES.forEach((tile, i) => {
    const el = document.createElement('div');
    el.className = 'tile';
    el.style.setProperty('--i', String(i));
    if (tile.accent) el.dataset['accent'] = 'true';
    const b = document.createElement('b');
    b.textContent = tile.title;
    const span = document.createElement('span');
    span.textContent = tile.detail;
    el.append(b, span);
    tiles.append(el);
  });

  $('home').replaceChildren(head, ask, tiles);
}

/* ------------------------------------------------------------------ *
 * Driving the demo
 * ------------------------------------------------------------------ */

let beat = -1;

function syncRail(): void {
  rail.update(renderer.getActions());
}

/** Advance to the next scripted surface. Stands in for the orchestrator. */
function advance(to = beat + 1): void {
  const next = DEMO[to];
  if (next === undefined) return;
  beat = to;

  setState('surface');
  face.setMood('thinking');

  surface.dataset['gen'] = surface.dataset['gen'] === '0' ? '1' : '0';

  renderer.applySkeleton({
    v: 1,
    templateId: next.templateId,
    maxWidth: TEMPLATES[next.templateId].maxWidth,
  });
  syncRail();

  window.setTimeout(() => {
    renderer.applyStyle(next.style);
  }, 90);

  window.setTimeout(() => {
    renderer.applyContent(next.content);
    syncRail();
    face.setMood('pleased');
    window.setTimeout(() => face.setMood('idle'), 700);
  }, 430);

  if (next.polish) {
    window.setTimeout(() => renderer.applyPolish(next.polish!), 1400);
  }
}

function reset(): void {
  beat = -1;
  setState('greeting');
  face.setMood('idle');
  rail.update([]);
  void face.greet().then(() => {
    if (shell.dataset['state'] === 'greeting') setState('home');
  });
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

const setMood = (mood: Mood): void => face.setMood(mood);

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;

  if (event.key >= '1' && event.key <= '4') {
    const action = rail.actionFor(Number(event.key) - 1);
    if (action === null) return;
    advance();
    return;
  }

  switch (event.key) {
    case ' ':
      event.preventDefault();
      $('listening').hidden = false;
      setMood('listening');
      break;
    case 'Enter':
      advance();
      break;
    case 'Backspace':
      reset();
      break;
    case '?':
      setMood('unsure');
      break;
    default:
      break;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key !== ' ') return;
  $('listening').hidden = true;
  setMood('thinking');
  window.setTimeout(() => advance(), 260);
});

$('surface').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (target) advance();
});

$('home').addEventListener('click', () => advance(0));
$('greeting').addEventListener('click', () => setState('home'));

paintHome();
reset();
