import { h } from './dom';

/** Colours offered under the picker: the interface inks plus the looks' own palette. */
const SWATCHES = [
  '#ffffff', '#ecedee', '#a1a1aa', '#71717a', '#18181b', '#09090b', '#0b0c0e', '#efebe3',
  '#fff4de', '#d9a866', '#ffb23f', '#e0356f', '#39d67a', '#8edcf0', '#3f8efc', '#0f2f6e',
];

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  return [hue, max ? d / max : 0, max];
}

function hsvToHex(hue: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

let current: { el: HTMLElement; close: () => void } | null = null;

/** Opens the fill picker next to `anchor`. `onInput` fires live as the colour changes. */
export function openPicker(anchor: HTMLElement, value: string, onInput: (hex: string) => void): void {
  current?.close();
  let [hue, sat, val] = hexToHsv(value);

  const dot = h('i', { class: 'pk-dot' });
  const sv = h('div', { class: 'pk-sv', role: 'slider', 'aria-label': 'Saturation and brightness', tabindex: '0' }, dot);
  const hueKnob = h('i');
  const hueBar = h('div', { class: 'pk-hue', role: 'slider', 'aria-label': 'Hue', tabindex: '0' }, hueKnob);
  const hex = h('input', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex colour' });
  const swatches = h(
    'div',
    { class: 'pk-sws' },
    ...SWATCHES.map((c) => {
      const b = h('button', { type: 'button', style: `background:${c}`, 'aria-label': c, title: c });
      b.addEventListener('click', () => {
        [hue, sat, val] = hexToHsv(c);
        paint(true);
      });
      return b;
    }),
  );
  const el = h('div', { class: 'pk', role: 'dialog', 'aria-label': 'Colour' }, sv, hueBar, h('div', { class: 'pk-fields' }, hex), swatches);

  const paint = (emit: boolean) => {
    const color = hsvToHex(hue, sat, val);
    sv.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hsvToHex(hue, 1, 1)})`;
    dot.style.left = `${sat * 100}%`;
    dot.style.top = `${(1 - val) * 100}%`;
    hueKnob.style.left = `${(hue / 360) * 100}%`;
    if (document.activeElement !== hex) hex.value = color;
    hex.classList.remove('bad');
    if (emit) onInput(color);
  };

  const drag = (target: HTMLElement, move: (x: number, y: number) => void) => {
    const handle = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      move(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
      paint(true);
    };
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      handle(e);
      const up = () => target.removeEventListener('pointermove', handle);
      target.addEventListener('pointermove', handle);
      target.addEventListener('pointerup', up, { once: true });
    });
  };
  drag(sv, (x, y) => {
    sat = x;
    val = 1 - y;
  });
  drag(hueBar, (x) => {
    hue = x * 359.9;
  });
  sv.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') sat = Math.max(0, sat - d);
    else if (e.key === 'ArrowRight') sat = Math.min(1, sat + d);
    else if (e.key === 'ArrowUp') val = Math.min(1, val + d);
    else if (e.key === 'ArrowDown') val = Math.max(0, val - d);
    else return;
    e.preventDefault();
    paint(true);
  });
  hueBar.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hue = (hue - d + 360) % 360;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hue = (hue + d) % 360;
    else return;
    e.preventDefault();
    paint(true);
  });
  hex.addEventListener('input', () => {
    const v = hex.value.trim().startsWith('#') ? hex.value.trim() : `#${hex.value.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      [hue, sat, val] = hexToHsv(v.toLowerCase());
      paint(false);
      onInput(v.toLowerCase());
    } else hex.classList.add('bad');
  });

  document.body.append(el);
  paint(false);
  const r = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  // Beside the rail, on whichever side has room; else under the chip.
  let left = r.left - width - 12;
  if (left < 10) left = r.right + 12;
  if (left + width > window.innerWidth - 10) left = Math.max(10, Math.min(r.left, window.innerWidth - width - 10));
  const top = Math.min(Math.max(10, r.top - 40), window.innerHeight - height - 10);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const outside = (e: Event) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      anchor.focus();
    }
  };
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key);
    if (current?.el === el) current = null;
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
  });
  current = { el, close };
  sv.focus();
}
