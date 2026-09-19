/**
 * The device's face.
 *
 * Deliberately not a generated surface — it is the one thing on the device that
 * is always the same, which is what makes it read as an identity rather than
 * output. It lives in the shell so the model can never "select" it mid-task.
 *
 * It is two strings of text and a crossfade. That is the entire implementation:
 * no SVG, no Lottie, no video, no per-frame JavaScript. Each mood is a pair of
 * near-identical kaomoji that differ only in the eyes, and the device winks by
 * fading one into the other — so the only property that ever animates is
 * `opacity`, which the compositor handles without touching layout or paint. On
 * a Pi that is the difference between a face that holds 60fps and one that
 * stutters whenever a surface is being built behind it.
 *
 * The glyphs come from the bundled `JIT Kaomoji` subset (see tokens/fonts.css).
 * Manrope contains none of them, and the device's fallback would paint tofu.
 */

export type Mood =
  /** Resting. Winks every few seconds. */
  | 'idle'
  /** Push-to-talk held. Eyes wide, everything leans in. */
  | 'listening'
  /** Working. Eyes lowered, scanning. */
  | 'thinking'
  /** Below the classifier's confidence threshold — visibly unsure, not guessing. */
  | 'unsure'
  /** Something landed. A squint-smile. */
  | 'pleased';

/** `greeting` is driven by `greet()` rather than `setMood`, so it is not a Mood. */
type FaceState = Mood | 'greeting';

/**
 * Two frames per mood.
 *
 * `rest` is what the face holds; `beat` is the eye position it flicks to. The
 * pair must differ ONLY in the eyes — if the arms, cheeks or mouth move too, the
 * crossfade reads as two different faces swapping rather than one face winking.
 *
 * `idle` is asymmetric on purpose: both eyes closing is a blink, and a blink
 * reads as idle machinery. One eye is a wink, and a wink reads as somebody home.
 *
 * No cheeks. The canonical form of this face carries U+02F6 either side of the
 * eyes, but every available face draws that codepoint as a heavy double prime,
 * so at this size it reads as a pair of quotation marks rather than as cheeks —
 * and dropping it is closer to the brief, which asked for simpler, not busier.
 */
const FRAMES: Record<FaceState, { rest: string; beat: string }> = {
  idle: { rest: '◝(• ◡ •)◜', beat: '◝(• ◡ ᵔ)◜' },
  greeting: { rest: '◝(• ◡ •)◜', beat: '◝(ᵔ ◡ ᵔ)◜' },
  listening: { rest: '◝(ʘ ◡ ʘ)◜', beat: '◝(° ◡ °)◜' },
  thinking: { rest: '(˘ ◡ ˘)', beat: '(• ◡ •)' },
  unsure: { rest: '(• _ •)', beat: '(˙ _ ˙)' },
  pleased: { rest: '◝(ᵔ ◡ ᵔ)◜', beat: '◝(• ◡ •)◜' },
};
/** What a screen reader hears. The face is state, so it is not decorative. */
const LABELS: Record<FaceState, string> = {
  idle: 'Ready',
  greeting: 'Hello',
  listening: 'Listening',
  thinking: 'Working on it',
  unsure: 'Not sure what you meant',
  pleased: 'Done',
};

export type Emoticon = {
  el: HTMLElement;
  setMood: (mood: Mood) => void;
  /** Says hello, resolving when the greeting is done. */
  greet: () => Promise<void>;
};

const GREETING_MS = 2200;

export function createEmoticon(host: HTMLElement): Emoticon {
  host.classList.add('face');
  host.setAttribute('role', 'img');

  const rest = document.createElement('span');
  rest.className = 'face-frame face-frame--rest';
  const beat = document.createElement('span');
  beat.className = 'face-frame face-frame--beat';
  host.replaceChildren(rest, beat);

  /**
   * Both frames are always in the DOM at their final size, so a mood change
   * swaps text inside a box whose dimensions never move. Nothing around the face
   * reflows when it changes expression.
   */
  const paint = (state: FaceState): void => {
    const frames = FRAMES[state];
    rest.textContent = frames.rest;
    beat.textContent = frames.beat;
    host.setAttribute('aria-label', LABELS[state]);
    host.dataset['mood'] = state;
  };

  paint('idle');

  return {
    el: host,
    setMood: paint,
    greet() {
      paint('greeting');
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          paint('idle');
          resolve();
        }, GREETING_MS);
      });
    },
  };
}
