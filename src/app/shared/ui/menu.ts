import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, inject, input, signal,
} from '@angular/core';
import { Icon, IconName } from './icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/**
 * Action menu: a kebab button by default, or the projected content with trigger="custom" (the header
 * account button). The panel uses the shared dropdown look and springs from its trigger.
 */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'menu-host' },
  template: `
    @if (trigger() === 'custom') {
      <button
        type="button"
        class="custom-trigger"
        [attr.aria-label]="label()"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        (click)="toggle($event)"
      >
        <ng-content />
      </button>
    } @else {
      <button
        class="btn ghost icon sm"
        [attr.aria-label]="label()"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        (click)="toggle($event)"
      >
        <app-icon [name]="icon()" />
      </button>
    }
    @if (open()) {
      <div class="pop" role="menu" [class.up]="up()" [style.top.px]="up() ? null : pos().top" [style.bottom.px]="up() ? pos().bottom : null"
           [style.right.px]="pos().right" (click)="$event.stopPropagation()">
        @for (item of items(); track item.label) {
          <button
            role="menuitem"
            [class.danger]="item.danger"
            [disabled]="item.disabled"
            (click)="item.run(); open.set(false)"
          >
            @if (item.icon) { <app-icon [name]="item.icon" [size]="16" /> }
            {{ item.label }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './menu.css',
})
export class Menu {
  readonly items = input.required<MenuItem[]>();
  readonly label = input('Actions');
  readonly icon = input<IconName>('more');
  /** "custom" renders the projected content as the trigger. */
  readonly trigger = input<'icon' | 'custom'>('icon');
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly pos = signal({ top: 0, bottom: 0, right: 0 });
  private readonly host = inject(ElementRef<HTMLElement>);

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  close() {
    this.open.set(false);
  }

  /**
   * Opens below the trigger (or above it near the bottom of the screen), right-aligned to it. Measured here, on the
   * trigger's own click: the click stops at the trigger so the document listener doesn't close the menu at once,
   * which means a listener on the host never sees it.
   */
  protected toggle(event: MouseEvent) {
    event.stopPropagation();
    if (!this.open()) this.measure();
    this.open.update((v) => !v);
  }

  private measure() {
    const r = this.host.nativeElement.getBoundingClientRect();
    this.up.set(window.innerHeight - r.bottom < 220);
    this.pos.set({ top: r.bottom + 8, bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right });
  }

  constructor() {
    // A fixed menu would drift from its trigger, so any scroll (the page scrolls, not the window) closes it.
    // Capture phase, because scroll events don't bubble.
    const close = () => this.open() && this.open.set(false);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    });
  }
}
