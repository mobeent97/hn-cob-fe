import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Icon } from './icon';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'success' | 'error' | 'info';
  action?: { label: string; run: () => void };
  leaving?: boolean;
}

/** Sonner-style toasts: rise in from the bottom, leave faster than they came. */
@Injectable({ providedIn: 'root' })
export class Toaster {
  readonly toasts = signal<Toast[]>([]);
  private id = 0;

  show(title: string, opts: Partial<Omit<Toast, 'id' | 'title'>> = {}) {
    const t: Toast = { id: ++this.id, title, tone: 'success', ...opts };
    this.toasts.update((xs) => [...xs.slice(-2), t]);
    setTimeout(() => this.dismiss(t.id), opts.action ? 6000 : 4000);
  }
  error(title: string, body?: string) {
    this.show(title, { tone: 'error', body });
  }
  dismiss(id: number) {
    this.toasts.update((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => this.toasts.update((xs) => xs.filter((x) => x.id !== id)), 200);
  }
}

@Component({
  selector: 'app-toaster',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="stack" aria-live="polite">
      @for (t of toaster.toasts(); track t.id) {
        <li class="toast" [class.leaving]="t.leaving" [attr.data-tone]="t.tone">
          <app-icon [name]="t.tone === 'error' ? 'circle-x' : t.tone === 'info' ? 'info' : 'circle-check'" [size]="18" class="ic" />
          <div class="text">
            <strong>{{ t.title }}</strong>
            @if (t.body) { <span>{{ t.body }}</span> }
          </div>
          @if (t.action) {
            <button class="btn sm" (click)="t.action.run(); toaster.dismiss(t.id)">{{ t.action.label }}</button>
          }
          <button class="btn ghost icon sm" aria-label="Dismiss" (click)="toaster.dismiss(t.id)">
            <app-icon name="x" [size]="14" />
          </button>
        </li>
      }
    </ol>
  `,
  styles: `
    .stack {
      position: fixed; right: 20px; bottom: 20px; z-index: 1000;
      display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none;
      width: min(380px, calc(100vw - 32px));
    }
    .toast {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 12px 12px 14px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card);
      box-shadow: var(--shadow-float);
      transition: opacity var(--duration-quick) var(--ease-out), transform var(--duration-quick) var(--ease-out), filter var(--duration-quick) ease;
      @starting-style { opacity: 0; transform: translateY(12px) scale(0.98); filter: blur(var(--blur-small)); }
    }
    .toast { transition-duration: var(--duration-fast); }
    .toast.leaving { opacity: 0; transform: translateY(6px) scale(0.98); transition-duration: var(--duration-quick); }
    .ic { margin-top: 1px; color: var(--positive); }
    [data-tone='error'] .ic { color: var(--negative); }
    [data-tone='info'] .ic { color: var(--accent); }
    .text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .text span { color: var(--muted); font-size: 13px; }
    @media (max-width: 640px) { .stack { left: 16px; right: 16px; bottom: 16px; width: auto; } }
  `,
})
export class ToasterHost {
  protected readonly toaster = inject(Toaster);
}
