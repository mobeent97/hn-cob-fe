import {
  ChangeDetectionStrategy, Component, ElementRef, effect, input, model, output, signal, viewChild,
} from '@angular/core';
import { Icon } from './icon';

/**
 * Modal dialog (native <dialog>) or a right-hand drawer (variant="drawer").
 * Opens with a scale-up / slide, closes faster and softer (transitions.dev modal + panel reveal).
 * Bind [(open)]; project content, and buttons into [slot=footer].
 */
@Component({
  selector: 'app-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dlg
      [class]="variant()"
      [class.closing]="closing()"
      [style.--w]="width()"
      (cancel)="$event.preventDefault(); close()"
      (click)="backdrop($event)"
      [attr.aria-labelledby]="'dlg-title-' + uid"
    >
      <div class="frame">
        <header>
          <div>
            <h2 [id]="'dlg-title-' + uid">{{ heading() }}</h2>
            @if (subheading()) { <p class="muted">{{ subheading() }}</p> }
          </div>
          <button class="btn ghost icon sm" aria-label="Close" (click)="close()"><app-icon name="x" /></button>
        </header>
        <div class="body"><ng-content /></div>
        <footer><ng-content select="[slot=footer]" /></footer>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      padding: 0; border: 1px solid var(--border); background: var(--surface); color: var(--text);
      box-shadow: var(--shadow-dialog); max-height: calc(100dvh - 48px); overflow: hidden;
    }
    dialog::backdrop { background: rgb(18 20 23 / 0%); transition: background-color var(--duration-fast) var(--ease-out), overlay var(--duration-fast) allow-discrete, display var(--duration-fast) allow-discrete; }
    dialog[open]::backdrop { background: var(--overlay); }
    @starting-style { dialog[open]::backdrop { background: rgb(18 20 23 / 0%); } }
    dialog.closing::backdrop { background: rgb(18 20 23 / 0%); }

    .modal {
      width: min(var(--w, 560px), calc(100vw - 32px)); border-radius: 12px;
      transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
    }
    .modal[open] { opacity: 1; transform: none; } /* none, not scale(1): a transform would trap fixed dropdowns inside */
    @starting-style { .modal[open] { opacity: 0; transform: scale(var(--scale-modal)); } }
    .modal.closing { opacity: 0; transform: scale(0.98); transition-duration: var(--duration-quick); }

    .drawer {
      margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(var(--w, 520px), 100vw);
      border-radius: 0; border-width: 0 0 0 1px;
      transition: transform var(--duration-medium) var(--ease-drawer);
    }
    .drawer[open] { transform: none; }
    @starting-style { .drawer[open] { transform: translateX(100%); } }
    .drawer.closing { transform: translateX(100%); transition-duration: var(--duration-fast); }

    .frame { display: flex; flex-direction: column; max-height: inherit; height: 100%; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 18px 20px 4px; }
    header p { margin-top: 2px; }
    .body { padding: 14px 20px 20px; overflow: auto; flex: 1; }
    footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--rule); }
    footer:empty { display: none; }
  `,
})
export class Dialog {
  readonly open = model(false);
  readonly heading = input('');
  readonly subheading = input('');
  readonly variant = input<'modal' | 'drawer'>('modal');
  readonly width = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly closing = signal(false);
  protected readonly uid = Math.random().toString(36).slice(2, 8);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) {
        this.closing.set(false);
        el.showModal();
      } else if (!this.open() && el.open) {
        this.animateOut();
      }
    });
  }

  close() {
    this.open.set(false);
  }

  protected backdrop(e: MouseEvent) {
    if (e.target === this.dlg().nativeElement) this.close();
  }

  private animateOut() {
    const el = this.dlg().nativeElement;
    this.closing.set(true);
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
    setTimeout(() => {
      el.close();
      this.closing.set(false);
      this.closed.emit();
    }, ms);
  }
}
