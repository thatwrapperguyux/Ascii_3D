import { readPref, writePref } from '../state/share';

/**
 * Interface sound: a short, dry tick, like the detent on a camera dial.
 * Synthesised rather than loaded, and the audio context is only created on the
 * first real gesture, which is what browsers require.
 */
type TickKind = 'step' | 'pick' | 'open' | 'close' | 'knock';

const SPEC: Record<TickKind, { f: number; d: number; g: number }> = {
  step: { f: 2100, d: 0.028, g: 0.03 },
  pick: { f: 1500, d: 0.045, g: 0.05 },
  open: { f: 1150, d: 0.06, g: 0.045 },
  close: { f: 820, d: 0.06, g: 0.04 },
  knock: { f: 640, d: 0.09, g: 0.055 },
};

let context: AudioContext | null = null;
let enabled = readPref('sound') !== 'off';

export function tick(kind: TickKind = 'step'): void {
  // Nothing before the first click or key press: browsers refuse audio until then.
  if (!enabled || navigator.userActivation?.hasBeenActive === false) return;
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume();
    const t = context.currentTime;
    const spec = SPEC[kind];
    const osc = context.createOscillator();
    const gain = context.createGain();
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 380;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(spec.f, t);
    osc.frequency.exponentialRampToValueAtTime(spec.f * 0.55, t + spec.d);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(spec.g, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.d);
    osc.connect(highpass);
    highpass.connect(gain);
    gain.connect(context.destination);
    osc.start(t);
    osc.stop(t + spec.d + 0.02);
  } catch {
    // Sound is a nicety; never let it break an interaction.
  }
}

/** Every control that changes something makes exactly one tick. */
export function wireSound(toggle: HTMLButtonElement): void {
  const apply = (on: boolean) => {
    enabled = on;
    toggle.setAttribute('aria-pressed', String(on));
    writePref('sound', on ? 'on' : 'off');
  };
  apply(enabled);
  toggle.addEventListener('click', () => {
    apply(!enabled);
    if (enabled) tick('pick');
  });

  document.addEventListener(
    'change',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('select')) tick('pick');
      else if (target.matches('input[type=checkbox]')) tick((target as HTMLInputElement).checked ? 'open' : 'close');
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.btn, .chip, .sw-btn, .seg button, .fsel-opt, .ctabtn, .iconbtn:not(#btn-sound)')) tick('pick');
      else if (target.closest('details.sec > summary')) {
        const details = target.closest('details.sec') as HTMLDetailsElement | null;
        tick(details?.open ? 'close' : 'open');
      } else if (target.closest('details.tip > summary')) tick('step');
    },
    true,
  );
  // Sliders tick once per detent, not once per pixel.
  const last = new Map<string, string>();
  document.addEventListener(
    'input',
    (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.matches('input[type=range]')) return;
      const key = target.id || 'range';
      if (last.get(key) !== target.value) {
        last.set(key, target.value);
        tick('step');
      }
    },
    true,
  );
}
