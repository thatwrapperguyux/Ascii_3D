import { iconMarkup, type IconName } from './icons';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Minimal element factory. `false`/`null`/`undefined` attributes and children are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

export function svg(name: IconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = iconMarkup(name);
  return template.content.firstElementChild as SVGSVGElement;
}

/** A panel icon (`.si`), as used in section headers and action plates. */
export function si(name: IconName): HTMLElement {
  return h('i', { class: 'si' }, svg(name));
}

/** Fills every `[data-ic]` element under `root` with its icon. */
export function paintIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-ic]').forEach((el) => {
    const name = el.dataset.ic as IconName;
    el.replaceChildren(svg(name));
  });
}

export function button(label: string, attrs: Attrs = {}, iconName?: IconName): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn ghost', ...attrs }, iconName ? svg(iconName) : null, h('span', {}, label));
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}
