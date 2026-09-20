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

/**
 * A microphone that cannot work outranks everything else here.
 *
 * It was being clobbered: the mic reported "no recogniser", then the
 * websocket connected a moment later and cleared the line — so the one
 * message explaining why the device could not hear anything lasted about a
 * second. A sticky message stays until it is explicitly cleared.
 */
let sticky: string | null = null;

function showStatus(text: string | null, options: { sticky?: boolean } = {}): void {
  if (options.sticky) sticky = text;
  const shown = sticky ?? text;
  status.textContent = shown ?? '';
  status.hidden = shown === null;
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
    // Name the address, because the usual cause is that the device was opened
    // at one host and the server is listening on another — which is invisible
    // from a message that only says it failed.
    showStatus(`no server at ${connection.url} — "${trimmed}" was not sent`);
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

/** The space a surface actually has: the stage, less nothing — the rail is its own row. */
function reportViewport(): void {
  const stage = document.querySelector('.stage');
  if (!stage) return;
  const box = stage.getBoundingClientRect();
  connection.viewport(Math.round(box.width), Math.round(window.innerHeight));
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  // Debounced: a drag fires this continuously, and each one would change what
  // the next surface is budgeted against mid-gesture.
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(reportViewport, 200);
});

const connection: Connection = connect({
  onStatus(next: ConnectionStatus, detail) {
    // Reported the moment the socket is live, and again on resize: the
    // composer budgets the next surface against this, and a stage it has to
    // guess at is a stage it gets wrong. `.stage` clips rather than scrolls,
    // so guessing high loses the bottom of every surface silently.
    if (next === 'live') reportViewport();
    if (next === 'live') showStatus(null);
    else if (next === 'connecting') showStatus('connecting…');
    else showStatus(`no server at ${connection.url} — ${detail ?? 'retrying'}`);
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

const talk = $<HTMLButtonElement>('talk');
const talkLabel = $('talk-label');
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
    if (next === 'listening') {
      shell.dataset['mic'] = 'live';
      talkLabel.textContent = 'Listening';
      return;
    }
    showPartial('');
    if (next === 'unavailable') {
      shell.dataset['mic'] = 'off';
      talkLabel.textContent = 'No mic';
      talk.disabled = true;
      // Loud, and with a way out: without the fallback a device whose
      // recogniser cannot work has no way to be driven at all (constraint 5).
      showStatus(`${detail ?? 'microphone unavailable'} — type instead`, { sticky: true });
      input.hidden = false;
      input.focus();
      return;
    }
    shell.dataset['mic'] = 'idle';
    talkLabel.textContent = 'Hold to talk';
  },
});

/* ------------------------------------------------------------------ *
 * Hold to talk
 * ------------------------------------------------------------------ */

/**
 * Press starts listening, release sends.
 *
 * The pointer is captured on press, so a finger that slides off the button —
 * or off the panel entirely — still delivers its `pointerup` here. Without
 * that the microphone stays open after the user has plainly stopped, which is
 * how the room gets transcribed again.
 */
function press(event: PointerEvent): void {
  if (!dictation.available) return;
  event.preventDefault();
  talk.setPointerCapture(event.pointerId);
  showStatus(null);
  dictation.start();
}

function release(event: PointerEvent): void {
  if (talk.hasPointerCapture(event.pointerId)) talk.releasePointerCapture(event.pointerId);
  if (dictation.state === 'listening') dictation.finish();
}

talk.addEventListener('pointerdown', press);
talk.addEventListener('pointerup', release);
// A cancelled pointer (the browser taking over the gesture) is not a release:
// nothing was finished, so the partial is dropped rather than sent.
talk.addEventListener('pointercancel', () => dictation.stop());

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
    case ' ':
      // Hold to talk. The device listens while the key is down and sends on
      // release; it hears nothing the rest of the time.
      event.preventDefault();
      if (dictation.available && dictation.state !== 'listening') {
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
// Tapping the home tiles does nothing yet — the tiles are shell decoration,
// and inventing an action for them would be a flow nobody asked for.

/**
 * Release sends what was heard.
 *
 * The microphone is NOT opened at boot. It was, and the device spent the
 * evening transcribing the room — the turn log filled with bystanders'
 * conversation, each sentence routed and each one repainting the screen.
 * Listening now starts when someone holds the key and stops when they let go.
 */
window.addEventListener('keyup', (event) => {
  if (event.key !== ' ' || event.target === input) return;
  event.preventDefault();
  if (dictation.state === 'listening') dictation.finish();
});

// The mic stays shut until asked, but the permission prompt should not land
// in the middle of the first utterance — so ask for it now and release it.
void navigator.mediaDevices?.getUserMedia({ audio: true })
  .then((stream) => { for (const track of stream.getTracks()) track.stop(); })
  .catch(() => { /* denied is reported by `dictation` on first press */ });

paintHome();
reset();
