/**
 * The device's face.
 *
 * Deliberately not a generated surface — it is the one thing on the device that
 * is always the same, which is what makes it read as an identity rather than
 * output. It lives in the shell so the model can never "select" it mid-task.
 *
 * Built from four rectangles, animated by CSS. No SVG library, no Lottie, no
 * video: this runs on a Pi and has to stay cheap, and a geometric face made of
 * rectangles is also the most Metro thing it could possibly be.
 */

export type Mood =
  /** Resting. Blinks occasionally, glances around. */
  | 'idle'
  /** Push-to-talk held. Eyes open, everything leans in. */
  | 'listening'
  /** Working. Eyes track back and forth. */
  | 'thinking'
  /** Below the classifier's confidence threshold — visibly unsure, not guessing. */
  | 'unsure'
  /** Something landed. A brief squint-smile. */
  | 'pleased';

export type Emoticon = {
  el: HTMLElement;
  setMood: (mood: Mood) => void;
  /** Says hello, resolving when the greeting is done. */
  greet: () => Promise<void>;
};

const GREETING_MS = 2200;

export function createEmoticon(host: HTMLElement): Emoticon {
  host.classList.add('face');
  host.dataset['mood'] = 'idle';

  const eyes = document.createElement('div');
  eyes.className = 'face-eyes';
  const left = document.createElement('i');
  const right = document.createElement('i');
  left.className = 'face-eye face-eye--l';
  right.className = 'face-eye face-eye--r';
  eyes.append(left, right);

  const mouth = document.createElement('div');
  mouth.className = 'face-mouth';
  mouth.append(document.createElement('i'));

  host.replaceChildren(eyes, mouth);

  return {
    el: host,
    setMood(mood) {
      host.dataset['mood'] = mood;
    },
    greet() {
      host.dataset['mood'] = 'greeting';
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          host.dataset['mood'] = 'idle';
          resolve();
        }, GREETING_MS);
      });
    },
  };
}
