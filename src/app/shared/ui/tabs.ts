import {
  ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, input, model, signal, viewChildren,
} from '@angular/core';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

/** Underline tabs on a full-width rule; the 2px indicator slides between labels (transitions.dev tabs sliding). */
@Component({
  selector: 'app-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist">
      @for (t of tabs(); track t.id) {
        <button
          #tab
          role="tab"
          [attr.aria-selected]="t.id === value()"
          [class.active]="t.id === value()"
          (click)="value.set(t.id)"
        >
          {{ t.label }}
          @if (t.count !== undefined) { <span class="count num">{{ t.count }}</span> }
        </button>
      }
      <span class="indicator" [style.transform]="'translateX(' + x() + 'px)'" [style.width.px]="w()" [class.ready]="ready()"></span>
    </div>
  `,
  styles: `
    .tabs { position: relative; display: flex; gap: 24px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
    button {
      border: 0; background: none; padding: 0 0 11px; color: var(--muted); font-weight: 500; white-space: nowrap;
      display: inline-flex; gap: 6px; align-items: center; transition: color var(--duration-quick) ease;
    }
    button:hover, button.active { color: var(--text); }
    .count { color: var(--muted); font-weight: 400; }
    .indicator {
      position: absolute; left: 0; bottom: -1px; height: 2px; background: var(--text); border-radius: 2px;
    }
    .indicator.ready { transition: transform var(--duration-fast) var(--ease-out), width var(--duration-fast) var(--ease-out); }
  `,
})
export class Tabs<T extends string = string> {
  readonly tabs = input.required<TabItem<T>[]>();
  readonly value = model.required<T>();
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tab');
  protected readonly x = signal(0);
  protected readonly w = signal(0);
  protected readonly ready = signal(false);

  constructor() {
    afterRenderEffect(() => {
      const i = this.tabs().findIndex((t) => t.id === this.value());
      const el = this.buttons()[i]?.nativeElement;
      if (!el) return;
      this.x.set(el.offsetLeft);
      this.w.set(el.offsetWidth);
      // Enable the slide only after the first placement, so the indicator doesn't fly in on load.
      if (!this.ready()) requestAnimationFrame(() => this.ready.set(true));
    });
  }
}
