import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, untracked } from '@angular/core';
import gsap from 'gsap';

/**
 * A figure that tweens to its new value when the data behind it changes (a filter, a period).
 * It does not count up on first paint: app screens don't perform entrances.
 */
@Component({
  selector: 'app-num',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'num' },
  template: '',
})
export class AnimatedNumber {
  readonly value = input.required<number>();
  readonly decimals = input(0);
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  private shown: number | null = null;
  private readonly fmt = (n: number) =>
    n.toLocaleString('en-GB', { minimumFractionDigits: this.decimals(), maximumFractionDigits: this.decimals() });

  constructor() {
    effect((onCleanup) => {
      const to = this.value();
      const from = this.shown;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (from === null || reduce || from === to) {
        this.shown = to;
        this.el.textContent = untracked(() => this.fmt(to));
        return;
      }
      const state = { v: from };
      const tw = gsap.to(state, {
        v: to,
        duration: 0.45,
        ease: 'power3.out',
        onUpdate: () => {
          this.shown = state.v;
          this.el.textContent = this.fmt(this.decimals() ? state.v : Math.round(state.v));
        },
        onComplete: () => (this.shown = to),
      });
      onCleanup(() => tw.kill());
    });
  }
}
