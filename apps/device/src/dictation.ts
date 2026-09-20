/**
 * Voice in.
 *
 * The device is driven by speech, so this sits in front of the wire: partial
 * text appears while you are still talking, and the finished utterance is what
 * `connection.say` sends. CLAUDE.md budgets skeleton paint at 250ms from END
 * of utterance, which means the transcript has to be ready the moment you stop
 * — not a second later — so endpointing is the recogniser's job and the
 * pipeline starts on `final`, never on a partial.
 *
 * **Partials are shown, never acted on.** Routing on a partial would classify
 * "actually I used three—" as a different utterance from the one the user is
 * in the middle of saying, and the surface would change under them mid
 * sentence. They exist to make the device feel immediate, which is a
 * different job from deciding anything.
 *
 * A seam, because the browser recogniser is not portable. `SpeechRecognition`
 * is a Chrome API backed by a Google service, and Chromium builds without that
 * service key (the usual Raspberry Pi package) define the constructor and then
 * fail with `network` on every start. That failure is reported rather than
 * swallowed: a device that looks like it is listening and never hears anything
 * is the worst version of constraint 5.
 */

export type DictationState = 'idle' | 'listening' | 'unavailable';

export type DictationHandlers = {
  /** Text so far, while the user is still speaking. Display only. */
  onPartial(text: string): void;
  /** A finished utterance. This is the only thing that drives a turn. */
  onFinal(text: string): void;
  onState(state: DictationState, detail?: string): void;
};

export type Dictation = {
  /** Open the mic. Safe to call when already listening. */
  start(): void;
  /** Close it. The current partial is discarded, not sent. */
  stop(): void;
  /**
   * Close the mic and send whatever has been heard so far as ONE final
   * utterance. This is what releasing a push-to-talk key does: the user has
   * said they are finished, which is a better endpoint than waiting for the
   * recogniser to decide the silence was long enough.
   */
  finish(): void;
  readonly state: DictationState;
  readonly available: boolean;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function recogniser(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * A recogniser that has failed this many times in a row is not going to start
 * working. Past it the device stops pretending and says the mic is
 * unavailable, rather than looping a restart nobody can see.
 */
const GIVE_UP_AFTER = 3;

export function createDictation(
  handlers: DictationHandlers,
  options: { lang?: string; pushToTalk?: boolean } = {},
): Dictation {
  /**
   * Hold-to-talk by default, and this is not a preference.
   *
   * Always-listening transcribed the ROOM: the turn log filled with
   * "do you want me to do anything in parallel" and "we have and then just
   * let one agency" — bystanders' conversation, each one routed and each one
   * repainting the screen. On a demo floor the microphone has to be told when
   * to listen, or the device is driven by whoever is standing nearby.
   */
  const pushToTalk = options.pushToTalk ?? true;
  const Ctor = recogniser();
  if (!Ctor) {
    handlers.onState('unavailable', 'this browser has no SpeechRecognition');
    return { start: () => {}, stop: () => {}, finish: () => {}, state: 'unavailable', available: false };
  }

  let state: DictationState = 'idle';
  let wanted = false;
  let failures = 0;
  let recognition: SpeechRecognitionLike | null = null;
  /** The best transcript so far this press, final or not. */
  let heard = '';

  const setState = (next: DictationState, detail?: string): void => {
    if (state === next) return;
    state = next;
    handlers.onState(next, detail);
  };

  const build = (): SpeechRecognitionLike => {
    const r = new Ctor();
    // Continuous so the user can just talk — the device is meant to be spoken
    // to, not operated. Interim results are what make it feel immediate.
    r.continuous = true;
    r.interimResults = true;
    r.lang = options.lang ?? 'en-US';
    r.maxAlternatives = 1;

    r.onstart = () => {
      failures = 0;
      setState('listening');
    };

    r.onresult = (event) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const finalText = text.trim();
          if (!finalText) continue;
          heard = finalText;
          // In push-to-talk the user decides when they are done, so a final
          // from the recogniser is banked rather than sent — `finish()` is
          // what releases it. Continuous mode has no such signal and sends.
          if (!pushToTalk) {
            heard = '';
            handlers.onFinal(finalText);
          }
        } else {
          partial += text;
        }
      }
      const trimmed = partial.trim();
      if (trimmed) {
        if (pushToTalk) heard = trimmed;
        handlers.onPartial(trimmed);
      }
    };

    r.onerror = (event) => {
      // `no-speech` and `aborted` are ordinary in continuous mode — silence is
      // not a fault. Everything else is, and `network` specifically is the
      // Chromium-without-the-speech-service case worth naming.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      failures += 1;
      const detail = event.error === 'network'
        ? 'speech service unreachable — a Chromium build without it will never transcribe'
        : event.error === 'not-allowed'
          ? 'microphone permission denied'
          : `speech error: ${event.error}`;
      if (event.error === 'not-allowed' || failures >= GIVE_UP_AFTER) {
        wanted = false;
        setState('unavailable', detail);
        return;
      }
      setState('idle', detail);
    };

    r.onend = () => {
      recognition = null;
      // Continuous recognition still ends on its own — on a pause, or when the
      // service drops the stream. Restarting is what makes "always listening"
      // true rather than "listening until the first silence".
      if (wanted && state !== 'unavailable') {
        window.setTimeout(start, 120);
        return;
      }
      setState('idle');
    };

    return r;
  };

  function start(): void {
    if (state === 'unavailable' || recognition) return;
    wanted = true;
    try {
      recognition = build();
      recognition.start();
    } catch (err) {
      // `start()` throws if called while a previous instance is still winding
      // down. That is recoverable; a permission failure is not.
      recognition = null;
      failures += 1;
      if (failures >= GIVE_UP_AFTER) setState('unavailable', `could not start the microphone: ${String(err)}`);
    }
  }

  return {
    start,
    stop(): void {
      wanted = false;
      heard = '';
      const active = recognition;
      recognition = null;
      active?.abort();
      setState('idle');
    },

    finish(): void {
      wanted = false;
      const text = heard.trim();
      heard = '';
      const active = recognition;
      recognition = null;
      active?.abort();
      setState('idle');
      if (text) handlers.onFinal(text);
    },
    get state(): DictationState {
      return state;
    },
    get available(): boolean {
      return state !== 'unavailable';
    },
  };
}
