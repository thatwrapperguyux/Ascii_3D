import { SCHEMA, sanitizeValue, type SettingKey, type Settings } from '../state/schema';
import type { SettingsStore } from '../state/store';
import { h } from './dom';
import { Fsel, type FselOption } from './fsel';
import { openPicker } from './picker';

type KeysOfKind<Kind extends string> = {
  [K in SettingKey]: (typeof SCHEMA)[K]['kind'] extends Kind ? K : never;
}[SettingKey];

export type NumberKey = KeysOfKind<'number'>;
export type BoolKey = KeysOfKind<'bool'>;
export type ColorKey = KeysOfKind<'color'>;
export type EnumKey = KeysOfKind<'enum'>;
export type TextKey = KeysOfKind<'text'>;

export interface Control {
  el: HTMLElement;
  sync(settings: Readonly<Settings>): void;
  /** Shown only when this returns true. */
  when?: (settings: Readonly<Settings>) => boolean;
}

interface Common {
  when?: (settings: Readonly<Settings>) => boolean;
}

export interface ScrubOptions extends Common {
  unit?: string;
  /** Display multiplier, e.g. 100 to show 0.35 as 35%. */
  scale?: number;
  digits?: number;
}

const patch = <K extends SettingKey>(key: K, value: Settings[K]) => ({ [key]: value }) as Partial<Settings>;

function decimals(step: number): number {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

/**
 * A row you drag: the label on the left, the value on the right, the fill
 * showing where it sits. Double-click the row, or click the value, to type an
 * exact number (Enter or blur commits, Escape leaves it alone).
 */
export function scrub(store: SettingsStore, key: NumberKey, label: string, options: ScrubOptions = {}): Control {
  const spec = SCHEMA[key] as { min: number; max: number; step: number; default: number };
  const scale = options.scale ?? 1;
  const digits = options.digits ?? Math.max(0, decimals(spec.step) - Math.round(Math.log10(scale)));
  const unit = options.unit ?? '';
  const format = (v: number) => `${(v * scale).toFixed(digits)}${unit}`;

  const range = h('input', {
    type: 'range',
    id: `ctl-${key}`,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    'aria-label': label,
  });
  const value = h('output', { class: 'scrub-val', for: `ctl-${key}` });
  const el = h(
    'div',
    { class: 'scrub', title: 'Drag to change · double-click to type a number' },
    h('span', { class: 'scrub-ticks' }),
    h('span', { class: 'scrub-label' }, label),
    value,
    h('span', { class: 'scrub-grip' }),
    range,
  );

  const sync = (s: Readonly<Settings>) => {
    const v = s[key];
    if (range.valueAsNumber !== v) range.value = String(v);
    el.style.setProperty('--p', String(Math.max(0, Math.min(1, (v - spec.min) / (spec.max - spec.min)))));
    const text = format(v);
    if (value.textContent !== text) value.textContent = text;
    range.setAttribute('aria-valuetext', text);
  };
  range.addEventListener('input', () => store.set(patch(key, range.valueAsNumber)));

  const type = () => {
    if (el.classList.contains('typing')) return;
    el.classList.add('typing');
    const box = h('input', {
      type: 'text',
      class: 'scrub-type',
      inputmode: 'decimal',
      'aria-label': `${label}, type a number`,
    });
    box.value = (store.get(key) * scale).toFixed(digits);
    el.append(box);
    box.focus();
    box.select();
    let done = false;
    const close = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) {
        const n = parseFloat(box.value.replace(/[^0-9.\-]/g, ''));
        const next = Number.isFinite(n) ? sanitizeValue(key, n / scale) : undefined;
        if (next !== undefined) store.set(patch(key, next));
      }
      el.classList.remove('typing');
      box.remove();
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    });
    box.addEventListener('blur', () => close(true));
  };
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    type();
  });
  value.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      type();
    },
    true,
  );
  return { el, sync, when: options.when };
}

export function toggle(store: SettingsStore, key: BoolKey, label: string, common: Common = {}): Control {
  const input = h('input', { type: 'checkbox', id: `ctl-${key}` });
  const el = h('label', { class: 'chk' }, input, label);
  input.addEventListener('change', () => store.set(patch(key, input.checked)));
  return {
    el,
    when: common.when,
    sync: (s) => {
      if (input.checked !== s[key]) input.checked = s[key];
    },
  };
}

/** A label on the left and a drawn dropdown on the right. */
export function selectRow<K extends EnumKey>(
  store: SettingsStore,
  key: K,
  label: string,
  options: FselOption[],
  common: Common & { stacked?: boolean } = {},
): Control & { fsel: Fsel } {
  const fsel = new Fsel(`ctl-${key}`, label, options);
  fsel.onChange((v) => {
    const next = sanitizeValue(key, v);
    if (next !== undefined) store.set(patch(key, next));
  });
  const el = common.stacked
    ? h('div', { class: 'field' }, h('label', { for: `ctl-${key}-btn` }, label), fsel.el)
    : h('div', { class: 'row2' }, h('label', { for: `ctl-${key}-btn` }, label), fsel.el);
  return {
    el,
    fsel,
    when: common.when,
    sync: (s) => {
      fsel.value = s[key];
    },
  };
}

/** A swatch and its hex, opening the fill picker the way a drawing tool does. */
export function colorRow(store: SettingsStore, key: ColorKey, label: string, common: Common = {}): Control {
  const chip = h('i');
  const hex = h('span');
  const btn = h('button', { type: 'button', class: 'sw-btn', id: `ctl-${key}`, 'aria-label': `${label} colour` }, chip, hex);
  btn.addEventListener('click', () =>
    openPicker(btn, store.get(key), (v) => {
      const next = sanitizeValue(key, v);
      if (next !== undefined) store.set(patch(key, next));
    }),
  );
  const el = h('div', { class: 'crow' }, h('span', {}, label), btn);
  return {
    el,
    when: common.when,
    sync: (s) => {
      chip.style.background = s[key];
      if (hex.textContent !== s[key]) hex.textContent = s[key];
    },
  };
}

export function textField(
  store: SettingsStore,
  key: TextKey,
  label: string,
  common: Common & { placeholder?: string } = {},
): Control {
  const input = h('input', {
    type: 'text',
    id: `ctl-${key}`,
    class: 'txt-in mono',
    placeholder: common.placeholder ?? null,
    spellcheck: 'false',
    autocomplete: 'off',
  });
  input.addEventListener('input', () => {
    const next = sanitizeValue(key, input.value);
    if (next !== undefined) store.set(patch(key, next));
  });
  const el = h('div', { class: 'field' }, h('label', { for: `ctl-${key}` }, label), input);
  return {
    el,
    when: common.when,
    sync: (s) => {
      if (document.activeElement !== input) input.value = s[key];
    },
  };
}

/** "What this does": the explanation stays one click away instead of eating the panel. */
export function tip(...paragraphs: string[]): HTMLElement {
  return h('details', { class: 'tip' }, h('summary', {}, 'What this does'), ...paragraphs.map((p) => h('p', {}, p)));
}

export function grp(label: string): HTMLElement {
  return h('div', { class: 'grp' }, label);
}

/** Wraps arbitrary content that re-renders on every settings change. */
export function custom(el: HTMLElement, sync: (s: Readonly<Settings>) => void = () => {}, when?: Control['when']): Control {
  return { el, sync, when };
}
