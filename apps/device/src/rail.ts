import { BUTTON_COUNT, type ActionDescriptor } from '@jit/schema';

/**
 * The control rail: on-screen labels sitting directly adjacent to the physical
 * controls, so pressing one is never a guess.
 *
 * Reads `getActions()` and nothing else — it never inspects the surface. That
 * is the contract with the renderer, and it is also what will let the GPIO
 * bridge map the same descriptors without duplicating any logic.
 *
 * Labels animate when they change, because a control silently taking on a new
 * meaning is the single most confusing thing this device could do.
 */

export type Rail = {
  update: (actions: ActionDescriptor[]) => void;
  /** The action bound to a physical button, or null if that button is dark. */
  actionFor: (index: number) => ActionDescriptor | null;
  rangeAction: () => ActionDescriptor | null;
};

export function createRail(railHost: HTMLElement, faderHost: HTMLElement): Rail {
  let pressable: ActionDescriptor[] = [];
  let range: ActionDescriptor | null = null;

  const keys: HTMLElement[] = [];
  for (let i = 0; i < BUTTON_COUNT; i += 1) {
    const key = document.createElement('div');
    key.className = 'key';
    key.dataset['index'] = String(i);
    // Empty rather than absent: the rail must not resize when a surface maps
    // fewer controls, or every label shifts under the user's fingers.
    key.innerHTML = '<span class="key-label"></span><span class="key-pip"></span>';
    keys.push(key);
    railHost.append(key);
  }

  faderHost.innerHTML =
    '<span class="fader-label"></span>' +
    '<span class="fader-track"><i></i></span>' +
    '<span class="fader-poles"><b></b><b></b></span>';

  const setLabel = (el: HTMLElement, text: string): void => {
    if (el.textContent === text) return;
    el.textContent = text;
    // Restart the remap animation even if it is already running.
    el.classList.remove('is-remapped');
    void el.offsetWidth;
    el.classList.add('is-remapped');
  };

  return {
    update(actions) {
      pressable = actions.filter((a) => a.kind !== 'range').slice(0, BUTTON_COUNT);
      range = actions.find((a) => a.kind === 'range') ?? null;

      keys.forEach((key, i) => {
        const action = pressable[i];
        const label = key.querySelector<HTMLElement>('.key-label')!;
        // A label that has not arrived yet is not the same as no control: the
        // button is live, we just cannot say what it does yet.
        key.dataset['state'] =
          action === undefined ? 'dark' : action.label === null ? 'pending' : 'live';
        key.dataset['kind'] = action?.kind ?? '';
        setLabel(label, action?.label ?? '');
      });

      faderHost.hidden = range === null;
      if (range !== null && range.kind === 'range') {
        setLabel(faderHost.querySelector<HTMLElement>('.fader-label')!, range.label ?? '');
        const poles = faderHost.querySelectorAll<HTMLElement>('.fader-poles b');
        poles[0]!.textContent = range.range?.minLabel ?? '';
        poles[1]!.textContent = range.range?.maxLabel ?? '';
        const fill = faderHost.querySelector<HTMLElement>('.fader-track i')!;
        const r = range.range;
        const pct = r === null || r.max === r.min ? 0 : ((r.value - r.min) / (r.max - r.min)) * 100;
        fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      }
    },
    actionFor: (index) => pressable[index] ?? null,
    rangeAction: () => range,
  };
}
