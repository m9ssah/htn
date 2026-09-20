import { createJsonRenderer, toLegacyActions, type JsonSurfaceRenderer } from '@jit/renderer';
import { connect, type Connection, type ConnectionStatus } from './connection.js';
import { createDictation, type DictationState } from './dictation.js';
import { createEmoticon, type Mood } from './emoticon.js';
import { createRail } from './rail.js';
import { HOME_TILES } from './script.js';

/**
 * The device shell.
 *
 * Owns everything that is not a generated surface: the face, the home, the
 * control rail. It knows nothing about recipes — it moves between three states
 * and forwards control events.
 *
 * **Driven by `apps/server` over a websocket.** What appears is whatever the
 * orchestrator sends for what you said; the scripted beat-walker this used to
 * run on is gone. The keyboard remains as a stand-in for the mic and the
 * hardware rail (`apps/bridge`) — an utterance is typed rather than spoken,
 * but it takes the same path through the graph either way.
 *
 * When the server is unreachable the shell says so and keeps the surface it
 * has. It never falls back to canned beats: a device that looked alive while
 * disconnected is the exact failure CLAUDE.md constraint 5 forbids, and the
 * worst possible one to discover on stage.
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
const renderer: JsonSurfaceRenderer = createJsonRenderer(surface, { transitions: true });

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
    const w = tile.w ?? 1;
    const h = tile.h ?? 1;
    el.style.setProperty('--w', String(w));
    el.style.setProperty('--h', String(h));
    el.dataset['size'] = `${w}x${h}`;
    if (tile.tone) el.dataset['tone'] = tile.tone;
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

function syncRail(): void {
  rail.update(toLegacyActions(renderer.getActions()));
}

/**
 * The status line. Named states only — "live" is not announced, because the
 * normal case should be invisible; only a problem earns pixels.
 */
const status = $('status');
function showStatus(text: string | null): void {
  status.textContent = text ?? '';
  status.hidden = text === null;
}

let painted = false;

/**
 * Applied in arrival order, exactly as received.
 *
 * The staged look — structure, then style, then content — is the SERVER's
 * emission order, not a timer here. The old scripted version faked it with
 * setTimeout; faking it now would desynchronise the shell from what actually
 * arrived and make a slow content patch look like a fast one.
 *
 * `data-gen` flips per turn so the renderer's turnstile has a generation to
 * animate between.
 */
function onUpdate(update: Parameters<JsonSurfaceRenderer['apply']>[0]): void {
  if (!painted) {
    setState('surface');
    painted = true;
  }
  renderer.apply(update);
  syncRail();
}

function say(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (!connection.say(trimmed)) {
    showStatus('not connected — nothing was sent');
    return;
  }
  face.setMood('thinking');
  surface.dataset['gen'] = surface.dataset['gen'] === '0' ? '1' : '0';
}

function reset(): void {
  painted = false;
  setState('greeting');
  face.setMood('idle');
  rail.update([]);
  void face.greet().then(() => {
    if (shell.dataset['state'] === 'greeting') setState('home');
  });
}

const connection: Connection = connect({
  onStatus(next: ConnectionStatus, detail) {
    if (next === 'live') showStatus(null);
    else if (next === 'connecting') showStatus('connecting…');
    else showStatus(`server unreachable — ${detail ?? 'retrying'}`);
  },
  onTurnStart() {
    face.setMood('thinking');
  },
  onUpdate(update) {
    onUpdate(update);
  },
  onTurnEnd(outcome, updates) {
    if (outcome === 'ok' && updates > 0) {
      face.setMood('pleased');
      window.setTimeout(() => face.setMood('idle'), 700);
      return;
    }
    // Nothing painted, or the turn was cut short. The surface already up
    // stays up; the face says it did not land rather than pretending.
    face.setMood('unsure');
    showStatus(updates === 0 ? 'nothing to show for that one' : `turn ${outcome}`);
    window.setTimeout(() => {
      face.setMood('idle');
      if (connection.status === 'live') showStatus(null);
    }, 1600);
  },
  onError(reason) {
    showStatus(reason);
  },
});

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

const setMood = (mood: Mood): void => face.setMood(mood);

/**
 * Typing is the fallback path, not the main one — the device is spoken to.
 * It stays because a noisy room, a denied microphone permission or a Chromium
 * without the speech service all end here, and because it is what a test can
 * drive.
 */
const input = $<HTMLInputElement>('utterance');

/* ------------------------------------------------------------------ *
 * Voice
 * ------------------------------------------------------------------ */

const listening = $('listening');
const heard = $('heard');

/**
 * What the device thinks it heard, while you are still saying it.
 *
 * Shown, never sent. The turn starts on the FINAL transcript (see
 * `dictation.ts`) — painting a new surface off a half-finished sentence would
 * change the screen under someone mid-utterance.
 */
function showPartial(text: string): void {
  heard.textContent = text;
  heard.hidden = text === '';
}

const dictation = createDictation({
  onPartial(text) {
    showPartial(text);
    face.setMood('listening');
  },
  onFinal(text) {
    showPartial('');
    // Straight onto the wire. An utterance arriving mid-turn is a barge-in,
    // which the server already treats as the normal way to correct yourself.
    say(text);
  },
  onState(next: DictationState, detail) {
    listening.hidden = next !== 'listening';
    if (next === 'listening') {
      shell.dataset['mic'] = 'live';
      return;
    }
    showPartial('');
    if (next === 'unavailable') {
      shell.dataset['mic'] = 'off';
      // Loud, because the alternative is a device that looks like it is
      // listening and never hears anything (constraint 5).
      showStatus(`${detail ?? 'microphone unavailable'} — type instead`);
      input.focus();
      return;
    }
    shell.dataset['mic'] = 'idle';
  },
});

input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  say(input.value);
  input.value = '';
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.target === input) return;

  // The four rail buttons. A press names the action the SURFACE declared,
  // so the device never invents one (`getActions()` is the contract).
  if (event.key >= '1' && event.key <= '4') {
    const action = rail.actionFor(Number(event.key) - 1);
    if (action === null) return;
    connection.act(action.action, action.slot);
    return;
  }

  switch (event.key) {
    case '/':
      // Focus the mic stand-in without typing a slash into it.
      event.preventDefault();
      input.focus();
      break;
    case ' ':
      // Hard mute. A hackathon floor is loud, and a device that must be told
      // to stop listening is easier to trust than one that cannot be.
      event.preventDefault();
      if (dictation.state === 'listening') {
        dictation.stop();
        showStatus('microphone off — press space to listen again');
      } else if (dictation.available) {
        showStatus(null);
        dictation.start();
      }
      break;
    case 'Backspace':
      reset();
      break;
    default:
      break;
  }
});



$('surface').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  const action = target?.dataset['action'];
  if (action) connection.act(action, target?.dataset['slot'] ?? '');
});

$('greeting').addEventListener('click', () => setState('home'));
$('home').addEventListener('click', () => input.focus());

paintHome();
reset();

// Open the microphone at boot: the device is meant to be spoken to, and a
// stream opened on first press would put permission and startup cost inside
// the utterance the user is already saying.
dictation.start();
