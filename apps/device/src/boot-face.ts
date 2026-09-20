/**
 * The one-time boot face.
 *
 * Real, illustrated eyes and a mouth — not the bundled kaomoji glyphs — with a
 * natural blink, a smile, a scripted look-left/look-right/look-center beat, a
 * small sprinkle burst on the smile, and pupils that glance toward a touch.
 * Shown once, at real power-on, then removed — there is no handoff to a
 * second face. Plain resets (Backspace) skip this entirely and go straight to
 * the existing lightweight kaomoji greeting in emoticon.ts.
 *
 * The eyes rest with a gentle half-lid rather than a fully open circle — the
 * open-circle version read as a wide, static stare rather than a friendly
 * face; a small permanent lid softens that into something closer to relaxed.
 *
 * emoticon.ts is deliberately text-and-crossfade, "no SVG, no Lottie, no
 * video, no per-frame JavaScript," because that face has to hold 60fps for
 * the entire session on this hardware. This one gets away with more only
 * because it costs the device exactly once. It still obeys the same absolute
 * rule as the rest of the shell: only `transform` and `opacity` ever animate.
 * The blink is `transform: scaleY()` on an eyelid rect from a fixed
 * `transform-origin`; the smile is an `opacity` crossfade between two
 * pre-drawn mouth paths; the sprinkles are small static-colour shapes that
 * only ever animate `transform`/`opacity`. Nothing here animates a path's own
 * `d`, `fill`, or `height` — those force geometry/paint work, not a GPU
 * composite.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

/** -1 = full left, 0 = center, 1 = full right; y is independent and usually 0. */
export type Gaze = { x: number; y: number };

export type BootFace = {
  el: SVGSVGElement;
  /** Plays one blink immediately, restarting it if one is already mid-flight. */
  blink: () => void;
  /** Crossfades the mouth from neutral to a smile. One-directional; this face
   * is never un-smiled. */
  smile: () => void;
  /** A handful of small shapes drift down and fade around the face — a one-shot
   * flourish, meant to land right as `smile()` does. */
  sprinkle: () => void;
  /** Moves both pupils toward a scripted direction, eased over the pupil's
   * own CSS transition — used for the look-left/look-right/center beat and
   * reused as the mechanism behind touch-follow. */
  lookAt: (gaze: Gaze) => void;
  /** Detaches listeners and removes the element. */
  destroy: () => void;
};

function makeEye(cx: number): { group: SVGGElement; pupilGroup: SVGGElement } {
  const group = svgEl('g');
  group.setAttribute('class', 'boot-eye');

  const white = svgEl('circle');
  white.setAttribute('class', 'boot-eye-white');
  white.setAttribute('cx', String(cx));
  white.setAttribute('cy', '60');
  white.setAttribute('r', '22');

  const pupil = svgEl('circle');
  pupil.setAttribute('class', 'boot-eye-pupil');
  pupil.setAttribute('cx', String(cx));
  pupil.setAttribute('cy', '61');
  pupil.setAttribute('r', '9');

  // A small static highlight — a real pupil isn't a flat, featureless dot,
  // and adding one is what separates "friendly cartoon eye" from "glaring
  // dot." Static: it moves with the pupil group's own transform for free.
  const highlight = svgEl('circle');
  highlight.setAttribute('class', 'boot-eye-highlight');
  highlight.setAttribute('cx', String(cx + 3));
  highlight.setAttribute('cy', '58');
  highlight.setAttribute('r', '2.4');

  const pupilGroup = svgEl('g');
  pupilGroup.setAttribute('class', 'boot-pupil-group');
  pupilGroup.append(pupil, highlight);

  // The lid rests partway down (see .boot-eyelid's base transform in
  // shell.css) rather than fully open — a soft, relaxed line instead of a
  // wide circular stare — and scales further down from its own top edge when
  // it blinks, the same way a real eyelid closes from above.
  const lid = svgEl('rect');
  lid.setAttribute('class', 'boot-eyelid');
  lid.setAttribute('x', String(cx - 24));
  lid.setAttribute('y', '36');
  lid.setAttribute('width', '48');
  lid.setAttribute('height', '48');
  lid.style.transformOrigin = `${cx}px 36px`;

  group.append(white, pupilGroup, lid);
  return { group, pupilGroup };
}

/**
 * Two pre-drawn mouths, stacked exactly on top of each other, crossfading via
 * opacity. `smile()` never needs to reverse for this one-time face, so there
 * is deliberately no `unsmile` — one fewer state to keep correct.
 */
function makeMouth(): { group: SVGGElement } {
  const group = svgEl('g');
  group.setAttribute('class', 'boot-mouth');

  const neutral = svgEl('path');
  neutral.setAttribute('class', 'boot-mouth-neutral');
  neutral.setAttribute('d', 'M 104 92 Q 120 95 136 92');

  const smile = svgEl('path');
  smile.setAttribute('class', 'boot-mouth-smile');
  smile.setAttribute('d', 'M 98 88 Q 120 106 142 88');

  group.append(neutral, smile);
  return { group };
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Only the shell's own static brand colours — no new hues invented. */
const SPRINKLE_COLOR_VARS = ['--sh-accent', '--sh-accent-2', '--sh-warn', '--sh-fg'];

export function createBootFace(host: HTMLElement): BootFace {
  const svg = svgEl('svg');
  svg.setAttribute('class', 'boot-face');
  svg.setAttribute('viewBox', '0 0 240 120');
  // Decorative only. The accessible label for the device's state lives on the
  // always-present kaomoji face in emoticon.ts, screen-reader-visible even
  // while this one is showing.
  svg.setAttribute('aria-hidden', 'true');

  const left = makeEye(70);
  const right = makeEye(170);
  const mouth = makeMouth();
  svg.append(left.group, right.group, mouth.group);
  host.append(svg);

  const pupilGroups = [left.pupilGroup, right.pupilGroup];

  /** A glance or a scripted look, not eyes leaving their sockets. */
  const MAX_OFFSET = 5;
  const applyGaze = (ox: number, oy: number): void => {
    for (const group of pupilGroups) group.style.transform = `translate(${ox}px, ${oy}px)`;
  };

  const lookAt = (gaze: Gaze): void => {
    applyGaze(gaze.x * MAX_OFFSET, gaze.y * MAX_OFFSET);
  };

  const lookToward = (clientX: number, clientY: number): void => {
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    applyGaze(
      Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dx / 14)),
      Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dy / 14)),
    );
  };

  const blink = (): void => {
    svg.classList.remove('is-blinking');
    // Force a style flush so re-adding the class restarts the animation even
    // when a blink triggered by a tap lands mid-way through the automatic one.
    void svg.getBoundingClientRect();
    svg.classList.add('is-blinking');
  };

  const smile = (): void => {
    svg.classList.add('is-smiling');
  };

  const sprinkle = (): void => {
    for (let i = 0; i < 8; i++) {
      const piece = svgEl('rect');
      piece.setAttribute('class', 'boot-sprinkle');
      piece.setAttribute('width', '5');
      piece.setAttribute('height', '9');
      piece.setAttribute('rx', '2.5');
      piece.setAttribute('x', String(rand(40, 200)));
      piece.setAttribute('y', String(rand(-30, 10)));
      const colorVar = SPRINKLE_COLOR_VARS[Math.floor(rand(0, SPRINKLE_COLOR_VARS.length))];
      piece.style.fill = `var(${colorVar})`;
      piece.style.setProperty('--sr', `${rand(-50, 50)}deg`);
      piece.style.setProperty('--sd', `${rand(0, 140)}ms`);
      piece.style.setProperty('--sfall', `${rand(70, 110)}px`);
      svg.append(piece);
      piece.addEventListener('animationend', () => piece.remove(), { once: true });
    }
  };

  const onPointerMove = (event: PointerEvent): void => lookToward(event.clientX, event.clientY);
  const onPointerDown = (event: PointerEvent): void => {
    lookToward(event.clientX, event.clientY);
    blink();
  };

  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerdown', onPointerDown);

  return {
    el: svg,
    blink,
    smile,
    sprinkle,
    lookAt,
    destroy() {
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.remove();
    },
  };
}
