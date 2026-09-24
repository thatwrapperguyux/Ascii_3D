import { h } from './dom';

export type ToastKind = 'info' | 'error';

export class Toaster {
  constructor(private readonly root: HTMLElement) {}

  show(message: string, kind: ToastKind = 'info', durationMs = kind === 'error' ? 6000 : 3200): void {
    const toast = h('div', { class: `toast ${kind}` }, h('span', {}, message));
    this.root.append(toast);
    while (this.root.children.length > 3) this.root.firstElementChild?.remove();
    const remove = () => toast.remove();
    toast.addEventListener('click', remove);
    setTimeout(remove, durationMs);
  }
}
