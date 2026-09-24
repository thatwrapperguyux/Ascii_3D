import { readPref, writePref } from '../state/share';
import { spinTorus } from './donut';
import { h } from './dom';
import { tick } from './sound';

interface Step {
  /** What the spotlight lands on. */
  sel: string;
  title: string;
  body: string;
  /** Glyphs for the card's little torus, so each step shows a different character. */
  ramp: string;
  place?: 'side' | 'above';
  pad?: number;
}

const STEPS: Step[] = [
  {
    sel: '#sec-model',
    title: 'Start with a model',
    body: 'Drop a GLB, glTF, FBX, OBJ or STL anywhere on the page, or pick a sample. The file stays on your computer.',
    ramp: ' .:-=+*#%@',
  },
  {
    sel: '#sec-look',
    title: 'Pick a look',
    body: 'Ten finished styles, each a complete set of glyphs, colours, light and effects. Mono follows the light and dark switch above the render.',
    ramp: ' ░▒▓█',
  },
  {
    sel: '#sec-glyphs',
    title: 'Choose the characters',
    body: 'Every cell of the render becomes one character, lightest to densest. Smaller cells show more detail; a custom set can spell anything.',
    ramp: ' .,:;i1tfLCG08@',
  },
  {
    sel: '#sec-tone',
    title: 'Shape the tone',
    body: 'Exposure, contrast and gamma decide which character each cell gets. Edge lines trace the outline with | / - \\.',
    ramp: ' ·:+×xX#',
  },
  {
    sel: '#sec-effects',
    title: 'Add some life',
    body: 'A scan beam that scrambles glyphs as it passes, a lens that decodes them under the cursor, glow, flicker and CRT lines.',
    ramp: ' 01',
  },
  {
    sel: '#sec-download',
    title: 'Take it with you',
    body: 'PNG up to four times the screen, a seamless video loop, an SVG of real, editable text, or the plain characters.',
    ramp: ' .:-=+*#%@',
  },
  {
    sel: '#sec-embed',
    title: 'Put it on your site',
    body: 'Download the embed, drop it on vercel.com/drop, paste the link back here, and copy the iframe code. Your uploaded model travels inside it.',
    ramp: ' <>/{}',
  },
  {
    sel: '#btn-random',
    title: 'Or roll the dice',
    body: 'Randomize tries a fresh look in one press, and X does the same from the keyboard. Take the tour again from the bottom of the left panel.',
    ramp: ' ⠁⠃⠇⡇⣇⣧⣷⣿',
    place: 'above',
    pad: 10,
  },
];

const SEEN = 'tour-v1';

/** A spotlight on each part of the interface in turn, with a card that says what it's for. */
export class Tour {
  private el: HTMLElement | null = null;
  private at = -1;
  private stopArt: (() => void) | null = null;
  private spot!: HTMLElement;
  private ring!: HTMLElement;
  private card!: HTMLElement;
  private art!: HTMLElement;
  private count!: HTMLElement;
  private title!: HTMLElement;
  private body!: HTMLElement;
  private dots!: HTMLElement;
  private next!: HTMLButtonElement;

  /** First visit only, and not on a phone, where the panels aren't shown. */
  maybeStart(): void {
    if (readPref(SEEN) === 'seen' || matchMedia('(max-width: 760px)').matches) return;
    window.setTimeout(() => this.start(), 900);
  }

  start(): void {
    this.build();
    this.el!.hidden = false;
    this.go(0);
  }

  end(): void {
    if (!this.el || this.el.hidden) return;
    this.el.hidden = true;
    this.stopArt?.();
    this.stopArt = null;
    this.at = -1;
    writePref(SEEN, 'seen');
  }

  private build(): void {
    if (this.el) return;
    this.spot = h('div', { class: 'tour-spot' });
    this.ring = h('div', { class: 'tour-ring' });
    this.art = h('pre', { 'aria-hidden': 'true' });
    this.count = h('b', {}, '1 / 8');
    this.title = h('h3', { id: 'tour-title' });
    this.body = h('p');
    this.dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' });
    const skip = h('button', { class: 'btn ghost', type: 'button' }, 'Skip tutorial');
    this.next = h('button', { class: 'btn primary', type: 'button' }, 'Next');
    this.card = h(
      'div',
      { class: 'tour-card', role: 'dialog', 'aria-labelledby': 'tour-title' },
      h('div', { class: 'tour-stage' }, this.art),
      h('div', { class: 'tour-body' }, h('p', { class: 'tour-eyebrow' }, this.count, ' · A quick tour'), this.title, this.body),
      h('div', { class: 'tour-foot' }, this.dots, skip, this.next),
    );
    this.el = h('div', { class: 'tour', id: 'tour', hidden: true }, this.spot, this.ring, this.card);
    document.body.append(this.el);

    skip.addEventListener('click', () => this.end());
    this.next.addEventListener('click', () => (this.at >= STEPS.length - 1 ? this.end() : this.go(this.at + 1)));
    document.addEventListener('keydown', (e) => {
      if (!this.el || this.el.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.end();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        this.next.click();
      } else if (e.key === 'ArrowLeft' && this.at > 0) {
        e.preventDefault();
        this.go(this.at - 1);
      }
    });
    window.addEventListener('resize', () => this.el && !this.el.hidden && this.place());
  }

  private go(index: number): void {
    const step = STEPS[index];
    if (!step) return this.end();
    this.at = index;
    const target = document.querySelector<HTMLElement>(step.sel);
    // Open the panel the step is about, so the light lands on its contents.
    if (target instanceof HTMLDetailsElement) target.open = true;
    this.stopArt?.();
    this.stopArt = spinTorus(this.art, 54, 20, step.ramp);
    this.count.textContent = `${index + 1} / ${STEPS.length}`;
    this.title.textContent = step.title;
    this.body.textContent = step.body;
    this.next.textContent = index === STEPS.length - 1 ? 'Done' : 'Next';
    this.dots.replaceChildren(...STEPS.map((_, i) => h('i', { class: i === index ? 'on' : '' })));
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Let the scroll and the panel's opening settle before measuring.
    window.setTimeout(() => this.place(), 260);
    this.next.focus({ preventScroll: true });
    tick('pick');
  }

  private place(): void {
    const step = STEPS[this.at];
    if (!step) return;
    const target = document.querySelector<HTMLElement>(step.sel);
    const visible = !!target && target.offsetParent !== null;
    this.spot.style.opacity = visible ? '' : '0';
    this.ring.style.opacity = visible ? '' : '0';
    const cardWidth = this.card.offsetWidth || 362;
    const cardHeight = this.card.offsetHeight || 380;
    if (!target || !visible) {
      this.card.style.left = `${Math.round((window.innerWidth - cardWidth) / 2)}px`;
      this.card.style.top = `${Math.round((window.innerHeight - cardHeight) / 2)}px`;
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = step.pad ?? 6;
    const x = r.left - pad;
    const y = Math.max(6, r.top - pad);
    const w = r.width + pad * 2;
    const hgt = Math.min(window.innerHeight - 12, r.bottom + pad) - y;
    for (const node of [this.spot, this.ring]) {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.width = `${w}px`;
      node.style.height = `${hgt}px`;
    }

    const gap = 16;
    let left: number;
    let top: number;
    if (step.place === 'above') {
      left = x + w / 2 - cardWidth / 2;
      top = y - cardHeight - gap;
      if (top < 10) top = y + hgt + gap;
    } else {
      // Beside the panel, on whichever side has the room.
      left = x + w + gap;
      if (left + cardWidth > window.innerWidth - 10) left = x - cardWidth - gap;
      top = y + hgt / 2 - cardHeight / 2;
    }
    this.card.style.left = `${Math.round(Math.min(Math.max(10, left), Math.max(10, window.innerWidth - cardWidth - 10)))}px`;
    this.card.style.top = `${Math.round(Math.min(Math.max(10, top), Math.max(10, window.innerHeight - cardHeight - 10)))}px`;
  }
}
