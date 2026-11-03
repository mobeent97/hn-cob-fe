import {
  ChangeDetectionStrategy, Component, ElementRef, effect, input, model, output, signal, viewChild,
} from '@angular/core';
import { Icon } from './icon';

/**
 * Modal dialog (native <dialog>) or a right-hand drawer (variant="drawer"), drawn as FleetPoint's modal:
 * rounded-3xl panel, blurred backdrop, title + muted line, footer with the secondary action then the primary.
 * Uses IoTility's dialog timings: the backdrop fades, the panel glides up on --ease-dialog and exits faster.
 * Stays a native <dialog> (top layer), so fixed dropdowns inside it are never clipped.
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
        <header class="modal-header">
          <div>
            <h2 [id]="'dlg-title-' + uid">{{ heading() }}</h2>
            @if (subheading()) { <p>{{ subheading() }}</p> }
          </div>
          <button type="button" class="modal-close" aria-label="Close" (click)="close()"><app-icon name="x" [size]="18" /></button>
        </header>
        <div class="body modal-content"><ng-content /></div>
        <footer class="modal-footer"><ng-content select="[slot=footer]" /></footer>
      </div>
    </dialog>
  `,
  styleUrl: './dialog.css',
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
    // Keep in sync with --duration-dialog-out (theme.css).
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
    setTimeout(() => {
      el.close();
      this.closing.set(false);
      this.closed.emit();
    }, ms);
  }
}
