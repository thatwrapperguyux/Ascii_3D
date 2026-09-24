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

const ICONS = {
  chevron: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  upload: '<path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3"/>',
  dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="5.7" cy="5.7" r=".6"/><circle cx="10.3" cy="10.3" r=".6"/><circle cx="8" cy="8" r=".6"/>',
  undo: '<path d="M5 3.5 2.5 6 5 8.5"/><path d="M2.5 6h7a4 4 0 0 1 0 8h-3"/>',
  play: '<path d="M5 3.2v9.6L12.5 8z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/>',
  link: '<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  target: '<circle cx="8" cy="8" r="5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
  file: '<path d="M4 1.8h5l3.2 3.2v9.2H4z"/><path d="M9 1.8V5h3.2"/>',
  camera: '<path d="M2.5 5h2.2l1.1-1.8h4.4L11.3 5h2.2v7.8h-11z"/><circle cx="8" cy="8.7" r="2.3"/>',
  record: '<circle cx="8" cy="8" r="4.2"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}

export function button(label: string, attrs: Attrs = {}, iconName?: IconName): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn', ...attrs }, iconName ? icon(iconName) : null, h('span', {}, label));
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}
