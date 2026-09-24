export type ToastKind = 'info' | 'error';

/** One message at a time, in the ink pill the interface uses for everything it says. */
export class Toaster {
  private timer = 0;

  constructor(private readonly el: HTMLElement) {}

  show(message: string, kind: ToastKind = 'info', durationMs = kind === 'error' ? 6000 : 3200): void {
    window.clearTimeout(this.timer);
    this.el.textContent = message;
    this.el.classList.toggle('error', kind === 'error');
    this.el.classList.add('show');
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), durationMs);
  }
}
