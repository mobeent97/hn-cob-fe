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

/** Row-action menu (kebab). Grows from its trigger, origin-aware (transitions.dev menu dropdown). */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'menu-host' },
  template: `
    <button
      class="btn ghost icon sm"
      [attr.aria-label]="label()"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      (click)="$event.stopPropagation(); open.set(!open())"
    >
      <app-icon [name]="icon()" />
    </button>
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
            @if (item.icon) { <app-icon [name]="item.icon" [size]="15" /> }
            {{ item.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .pop {
      /* fixed, so a scrolling table (.table-wrap) never clips the menu */
      position: fixed; z-index: 90; min-width: 188px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card);
      box-shadow: var(--shadow-float); padding: 4px; display: flex; flex-direction: column;
      transform-origin: top right;
      transition: opacity var(--duration-quick) var(--ease-out), transform var(--duration-fast) var(--ease-out);
      @starting-style { opacity: 0; transform: scale(var(--scale-menu)) translateY(-2px); }
    }
    .pop.up { transform-origin: bottom right; }
    button[role='menuitem'] {
      display: flex; align-items: center; gap: 10px; border: 0; background: none; text-align: left;
      height: 32px; padding: 0 10px; border-radius: 4px; color: var(--text); white-space: nowrap;
    }
    button[role='menuitem']:hover:not(:disabled) { background: var(--raised); }
    button[role='menuitem']:disabled { color: var(--faint); cursor: not-allowed; }
    button[role='menuitem'] app-icon { color: var(--muted); }
    .danger, .danger app-icon { color: var(--negative) !important; }
  `,
})
export class Menu {
  readonly items = input.required<MenuItem[]>();
  readonly label = input('Actions');
  readonly icon = input<IconName>('more');
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly pos = signal({ top: 0, bottom: 0, right: 0 });
  private readonly host = inject(ElementRef<HTMLElement>);

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  close() {
    this.open.set(false);
  }

  @HostListener('click')
  measure() {
    const r = this.host.nativeElement.getBoundingClientRect();
    this.up.set(window.innerHeight - r.bottom < 220);
    this.pos.set({ top: r.bottom + 4, bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
  }

  constructor() {
    // A fixed menu would drift from its trigger, so any scroll (the sheet scrolls, not the window) closes it.
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
