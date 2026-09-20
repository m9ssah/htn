import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDictation, type DictationState } from '../src/dictation.js';

/**
 * A stand-in for Chrome's `SpeechRecognition`, driven by the test.
 *
 * The real one needs a microphone and a network service, so the behaviour
 * worth pinning here is not "does Chrome transcribe" — it is what the DEVICE
 * does with what Chrome gives it: partials shown and never sent, finals sent,
 * and a recogniser that cannot work saying so instead of looking alive.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  started = false;
  aborted = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    this.started = false;
    this.onend?.();
  }

  abort(): void {
    this.aborted = true;
    this.started = false;
  }

  /** One `onresult` carrying a mix of final and interim pieces. */
  emit(pieces: Array<{ text: string; isFinal: boolean }>): void {
    const results = pieces.map((piece) => Object.assign([{ transcript: piece.text }], { isFinal: piece.isFinal }));
    this.onresult?.({ resultIndex: 0, results });
  }

  fail(error: string): void {
    this.onerror?.({ error });
  }
}

function setup(): {
  partials: string[];
  finals: string[];
  states: Array<{ state: DictationState; detail?: string }>;
} {
  (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  (globalThis as unknown as { window: unknown }).window = globalThis;
  const partials: string[] = [];
  const finals: string[] = [];
  const states: Array<{ state: DictationState; detail?: string }> = [];
  return { partials, finals, states };
}

const handlers = (box: ReturnType<typeof setup>) => ({
  onPartial: (t: string) => box.partials.push(t),
  onFinal: (t: string) => box.finals.push(t),
  onState: (s: DictationState, d?: string) => box.states.push(d === undefined ? { state: s } : { state: s, detail: d }),
});

afterEach(() => {
  FakeRecognition.instances = [];
  vi.useRealTimers();
});

describe('dictation', () => {
  it('opens continuously with interim results — the device is spoken to, not operated', () => {
    const box = setup();

    createDictation(handlers(box)).start();

    const r = FakeRecognition.instances[0]!;
    expect(r.continuous).toBe(true);
    expect(r.interimResults).toBe(true);
    expect(r.started).toBe(true);
  });

  it('shows a partial without sending it — a half-finished sentence must not route a turn', () => {
    const box = setup();
    createDictation(handlers(box)).start();

    FakeRecognition.instances[0]!.emit([{ text: 'actually i used three', isFinal: false }]);

    expect(box.partials).toEqual(['actually i used three']);
    expect(box.finals).toEqual([]);
  });

  it('sends the final transcript, trimmed, and clears the partial', () => {
    const box = setup();
    createDictation(handlers(box)).start();

    FakeRecognition.instances[0]!.emit([{ text: '  actually i used three times the sugar  ', isFinal: true }]);

    expect(box.finals).toEqual(['actually i used three times the sugar']);
  });

  it('ignores an empty final rather than sending a blank utterance', () => {
    const box = setup();
    createDictation(handlers(box)).start();

    FakeRecognition.instances[0]!.emit([{ text: '   ', isFinal: true }]);

    expect(box.finals).toEqual([]);
  });

  it('keeps listening across the pauses continuous recognition ends on', () => {
    vi.useFakeTimers();
    const box = setup();
    createDictation(handlers(box)).start();

    FakeRecognition.instances[0]!.onend?.();
    vi.advanceTimersByTime(200);

    // A second recogniser was started: "always listening" has to survive the
    // first silence, or it is "listening once".
    expect(FakeRecognition.instances.length).toBe(2);
  });

  it('treats silence as ordinary, not as a fault', () => {
    const box = setup();
    createDictation(handlers(box)).start();

    FakeRecognition.instances[0]!.fail('no-speech');

    expect(box.states.filter((s) => s.state === 'unavailable')).toEqual([]);
  });

  /**
   * The Raspberry Pi case. Chromium builds without the Google speech service
   * define the constructor and then fail on every start, so a device that
   * swallowed this would show a listening indicator and never hear anything.
   */
  it('says so when the speech service is unreachable, instead of looking alive', () => {
    vi.useFakeTimers();
    const box = setup();
    const d = createDictation(handlers(box));
    d.start();

    for (let i = 0; i < 3; i += 1) {
      FakeRecognition.instances.at(-1)!.fail('network');
      vi.advanceTimersByTime(200);
    }

    const dead = box.states.find((s) => s.state === 'unavailable');
    expect(dead, 'a recogniser that never works must be reported').toBeDefined();
    expect(dead?.detail).toContain('speech service unreachable');
    expect(d.available).toBe(false);
  });

  it('gives up immediately when the microphone is denied — retrying cannot help', () => {
    const box = setup();
    const d = createDictation(handlers(box));
    d.start();

    FakeRecognition.instances[0]!.fail('not-allowed');

    expect(d.state).toBe('unavailable');
    expect(box.states.at(-1)?.detail).toContain('permission denied');
  });

  it('stop() discards the partial rather than sending it', () => {
    const box = setup();
    const d = createDictation(handlers(box));
    d.start();
    FakeRecognition.instances[0]!.emit([{ text: 'never mind', isFinal: false }]);

    d.stop();

    expect(box.finals).toEqual([]);
    expect(FakeRecognition.instances[0]!.aborted).toBe(true);
    expect(d.state).toBe('idle');
  });

  it('reports unavailable when the browser has no recogniser at all', () => {
    const box = setup();
    delete (globalThis as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    const d = createDictation(handlers(box));

    expect(d.available).toBe(false);
    expect(box.states.at(-1)?.state).toBe('unavailable');
  });
});
