import { SCHEMA, sanitizeValue, type SettingKey, type Settings } from '../state/schema';
import type { SettingsStore } from '../state/store';
import { h } from './dom';

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

interface CommonOptions {
  hint?: string;
  when?: (settings: Readonly<Settings>) => boolean;
}

export interface SliderOptions extends CommonOptions {
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

function labelFor(id: string, text: string, hint?: string, resettable = false): HTMLLabelElement {
  const title = [hint, resettable ? 'Double-click to reset.' : ''].filter(Boolean).join(' ');
  return h('label', { for: id, title: title || null }, text);
}

export function slider(store: SettingsStore, key: NumberKey, label: string, options: SliderOptions = {}): Control {
  const spec = SCHEMA[key] as { min: number; max: number; step: number; default: number };
  const id = `ctl-${key}`;
  const scale = options.scale ?? 1;
  const digits = options.digits ?? Math.max(0, decimals(spec.step) - Math.round(Math.log10(scale)));
  const unit = options.unit ?? '';

  const range = h('input', { type: 'range', id, class: 'full', min: spec.min, max: spec.max, step: spec.step });
  const value = h('input', {
    type: 'text',
    class: 'num',
    id: `${id}-value`,
    inputmode: 'decimal',
    'aria-label': `${label} value`,
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const labelEl = labelFor(id, label, options.hint, true);
  const el = h('div', { class: 'field' }, labelEl, value, range);

  const format = (v: number) => `${(v * scale).toFixed(digits)}${unit}`;

  const sync = (s: Readonly<Settings>) => {
    const v = s[key];
    if (range.valueAsNumber !== v) range.value = String(v);
    range.style.setProperty('--fill', `${((v - spec.min) / (spec.max - spec.min)) * 100}%`);
    if (document.activeElement !== value) value.value = format(v);
  };

  range.addEventListener('input', () => store.set(patch(key, range.valueAsNumber)));
  value.addEventListener('change', () => {
    const next = sanitizeValue(key, parseFloat(value.value) / scale);
    if (next !== undefined) store.set(patch(key, next));
    value.value = format(store.get(key));
  });
  value.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') value.blur();
    if (e.key === 'Escape') {
      value.value = format(store.get(key));
      value.blur();
    }
  });
  labelEl.addEventListener('dblclick', () => store.set(patch(key, spec.default)));

  return { el, sync, when: options.when };
}

export function toggle(store: SettingsStore, key: BoolKey, label: string, options: CommonOptions = {}): Control {
  const id = `ctl-${key}`;
  const control = h('button', { type: 'button', role: 'switch', class: 'switch', id, 'aria-checked': 'false' });
  const el = h('div', { class: 'field' }, labelFor(id, label, options.hint), control);
  control.addEventListener('click', () => store.set(patch(key, !store.get(key))));
  return {
    el,
    when: options.when,
    sync: (s) => control.setAttribute('aria-checked', String(s[key])),
  };
}

export function select<K extends EnumKey>(
  store: SettingsStore,
  key: K,
  label: string,
  options: [Settings[K], string][],
  common: CommonOptions = {},
): Control {
  const id = `ctl-${key}`;
  const control = h('select', { id, class: 'full' }, ...options.map(([value, text]) => h('option', { value }, text)));
  const el = h('div', { class: 'field' }, labelFor(id, label, common.hint), control);
  control.addEventListener('change', () => {
    const next = sanitizeValue(key, control.value);
    if (next !== undefined) store.set(patch(key, next));
  });
  return {
    el,
    when: common.when,
    sync: (s) => {
      if (control.value !== s[key]) control.value = s[key];
    },
  };
}

export function segmented<K extends EnumKey>(
  store: SettingsStore,
  key: K,
  label: string,
  options: [Settings[K], string][],
  common: CommonOptions & { grid?: boolean } = {},
): Control {
  const id = `ctl-${key}`;
  const buttons = options.map(([value, text]) =>
    h('button', { type: 'button', role: 'radio', 'data-value': value, 'aria-checked': 'false', tabindex: '-1' }, text),
  );
  const group = h(
    'div',
    { class: `segmented${common.grid ? ' grid3' : ''}`, role: 'radiogroup', id, 'aria-label': label },
    ...buttons,
  );
  const el = h('div', { class: 'field' }, h('span', { class: 'label', title: common.hint ?? null }, label), group);

  const choose = (index: number) => {
    const next = sanitizeValue(key, options[index][0]);
    if (next !== undefined) store.set(patch(key, next));
    buttons[index].focus();
  };
  buttons.forEach((btn, i) => btn.addEventListener('click', () => choose(i)));
  group.addEventListener('keydown', (e) => {
    const current = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    choose((current + delta + buttons.length) % buttons.length);
  });

  return {
    el,
    when: common.when,
    sync: (s) => {
      for (const btn of buttons) {
        const on = btn.dataset.value === s[key];
        btn.setAttribute('aria-checked', String(on));
        btn.tabIndex = on ? 0 : -1;
      }
    },
  };
}

export function color(store: SettingsStore, key: ColorKey, label: string, common: CommonOptions = {}): Control {
  const id = `ctl-${key}`;
  const picker = h('input', { type: 'color', id, 'aria-label': label });
  const hex = h('input', {
    type: 'text',
    class: 'num',
    id: `${id}-hex`,
    maxlength: 7,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': `${label} hex value`,
  });
  const el = h('div', { class: 'field' }, labelFor(id, label, common.hint), h('div', { class: 'color-field' }, picker, hex));
  picker.addEventListener('input', () => store.set(patch(key, picker.value)));
  hex.addEventListener('change', () => {
    const next = sanitizeValue(key, hex.value.startsWith('#') ? hex.value : `#${hex.value}`);
    if (next !== undefined) store.set(patch(key, next));
    hex.value = store.get(key);
  });
  return {
    el,
    when: common.when,
    sync: (s) => {
      if (picker.value !== s[key]) picker.value = s[key];
      if (document.activeElement !== hex) hex.value = s[key];
    },
  };
}

export function text(
  store: SettingsStore,
  key: TextKey,
  label: string,
  common: CommonOptions & { placeholder?: string } = {},
): Control {
  const id = `ctl-${key}`;
  const input = h('input', {
    type: 'text',
    id,
    class: 'text-input mono full',
    placeholder: common.placeholder ?? null,
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const el = h('div', { class: 'field' }, labelFor(id, label, common.hint), input);
  input.addEventListener('input', () => {
    const next = sanitizeValue(key, input.value);
    if (next !== undefined) store.set(patch(key, next));
  });
  return {
    el,
    when: common.when,
    sync: (s) => {
      if (document.activeElement !== input) input.value = s[key];
    },
  };
}

/** A control that renders arbitrary content and re-renders on every settings change. */
export function custom(el: HTMLElement, sync: (s: Readonly<Settings>) => void, when?: Control['when']): Control {
  return { el, sync, when };
}
