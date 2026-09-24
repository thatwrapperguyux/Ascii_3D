import { h } from './dom';

export interface FselOption {
  value: string;
  label: string;
  group?: string;
  /** Draws a small tile: the ground with its ink on it. */
  swatch?: { ground: string; ink: string };
  hidden?: boolean;
}

let openInstance: Fsel | null = null;

/**
 * A drawn dropdown. A native select drops a system menu that ignores the rest
 * of the interface and has no room for a swatch, so the select stays as the
 * source of truth (and fires the `change` events) while this draws over it.
 */
export class Fsel {
  readonly el: HTMLElement;
  readonly select: HTMLSelectElement;
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLElement;
  private readonly swatch: HTMLElement;
  private options: FselOption[] = [];
  private pop: HTMLElement | null = null;
  private cursor = -1;

  constructor(id: string, ariaLabel: string, options: FselOption[]) {
    this.select = h('select', { id, tabindex: '-1', 'aria-hidden': 'true' });
    this.swatch = h('i', { class: 'fsw', hidden: true });
    this.label = h('span', { class: 'fsel-lab' });
    this.button = h(
      'button',
      { type: 'button', class: 'fsel-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': ariaLabel, id: `${id}-btn` },
      this.swatch,
      this.label,
      h('i', { class: 'fsel-chev', 'aria-hidden': 'true' }),
    );
    this.el = h('div', { class: 'fsel' }, this.select, this.button);
    this.setOptions(options);

    this.button.addEventListener('click', () => (this.pop ? this.close() : this.open()));
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.pop) this.open();
        else this.step(e.key === 'ArrowDown' ? 1 : -1);
      } else if ((e.key === 'Enter' || e.key === ' ') && this.pop) {
        e.preventDefault();
        const option = this.visible()[this.cursor];
        if (option) this.choose(option.value);
      } else if (e.key === 'Escape' && this.pop) {
        e.preventDefault();
        this.close();
      }
    });
  }

  get value(): string {
    return this.select.value;
  }

  set value(v: string) {
    if (this.select.value !== v) this.select.value = v;
    this.paint();
  }

  setOptions(options: FselOption[]): void {
    this.options = options;
    const current = this.select.value;
    this.select.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)));
    if (options.some((o) => o.value === current)) this.select.value = current;
    this.paint();
  }

  onChange(listener: (value: string) => void): void {
    this.select.addEventListener('change', () => listener(this.select.value));
  }

  private visible(): FselOption[] {
    return this.options.filter((o) => !o.hidden);
  }

  private paint(): void {
    const option = this.options.find((o) => o.value === this.select.value);
    this.label.textContent = option?.label ?? '';
    this.swatch.hidden = !option?.swatch;
    if (option?.swatch) {
      this.swatch.style.background = option.swatch.ground;
      this.swatch.style.color = option.swatch.ink;
    }
  }

  private choose(value: string): void {
    this.close();
    if (this.select.value === value) return;
    this.select.value = value;
    this.paint();
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private open(): void {
    openInstance?.close();
    openInstance = this;
    const pop = h('div', { class: 'fsel-pop', role: 'listbox', 'aria-label': this.button.getAttribute('aria-label') });
    let group: string | undefined;
    this.visible().forEach((o, i) => {
      if (o.group && o.group !== group) {
        group = o.group;
        pop.append(h('h5', {}, o.group));
      }
      const row = h(
        'button',
        {
          type: 'button',
          class: 'fsel-opt',
          role: 'option',
          'aria-selected': String(o.value === this.select.value),
          'data-index': i,
        },
        h('i', { class: 'fsel-tick', 'aria-hidden': 'true' }),
        o.swatch ? h('i', { class: 'fsw', style: `background:${o.swatch.ground};color:${o.swatch.ink}` }) : null,
        h('span', { class: 'fsel-otxt' }, o.label),
      );
      row.addEventListener('click', () => this.choose(o.value));
      row.addEventListener('pointermove', () => this.setCursor(i));
      pop.append(row);
    });
    document.body.append(pop);
    this.pop = pop;
    this.button.setAttribute('aria-expanded', 'true');
    this.el.classList.add('open');
    this.place();
    this.setCursor(this.visible().findIndex((o) => o.value === this.select.value));
    requestAnimationFrame(() => pop.classList.add('on'));
    setTimeout(() => {
      document.addEventListener('pointerdown', this.outside, true);
      window.addEventListener('resize', this.dismiss);
      document.addEventListener('scroll', this.dismiss, true);
    });
  }

  close(): void {
    if (!this.pop) return;
    this.pop.remove();
    this.pop = null;
    if (openInstance === this) openInstance = null;
    this.button.setAttribute('aria-expanded', 'false');
    this.el.classList.remove('open');
    document.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('resize', this.dismiss);
    document.removeEventListener('scroll', this.dismiss, true);
  }

  private readonly outside = (e: Event) => {
    if (!this.pop?.contains(e.target as Node) && !this.button.contains(e.target as Node)) this.close();
  };

  private readonly dismiss = (e: Event) => {
    if (e.type !== 'scroll') return this.close();
    if (this.pop?.contains(e.target as Node)) return;
    // Follow the button while its panel scrolls (a scroll can still be settling
    // as the list opens); close once the button has left the visible area.
    const r = this.button.getBoundingClientRect();
    const scroller = e.target instanceof Element ? e.target.getBoundingClientRect() : null;
    const top = Math.max(0, scroller?.top ?? 0);
    const bottom = Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight);
    if (r.bottom <= top || r.top >= bottom) this.close();
    else this.place();
  };

  private place(): void {
    if (!this.pop) return;
    const r = this.button.getBoundingClientRect();
    const width = Math.max(r.width, 190);
    this.pop.style.width = `${width}px`;
    const height = this.pop.offsetHeight;
    const below = window.innerHeight - r.bottom - 10;
    const top = below >= Math.min(height, 240) ? r.bottom + 6 : Math.max(10, r.top - height - 6);
    const left = Math.min(Math.max(10, r.left), window.innerWidth - width - 10);
    this.pop.style.top = `${top}px`;
    this.pop.style.left = `${left}px`;
  }

  private setCursor(index: number): void {
    if (!this.pop) return;
    this.cursor = index;
    this.pop.querySelectorAll('.fsel-opt').forEach((row, i) => row.classList.toggle('cur', i === index));
    this.pop.querySelectorAll<HTMLElement>('.fsel-opt')[index]?.scrollIntoView({ block: 'nearest' });
  }

  private step(delta: number): void {
    const count = this.visible().length;
    this.setCursor((this.cursor + delta + count) % count);
  }
}
