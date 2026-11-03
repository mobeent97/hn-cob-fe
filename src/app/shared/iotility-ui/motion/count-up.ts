import { DestroyRef, Directive, ElementRef, NgZone, effect, inject, input, untracked } from '@angular/core';

interface NumericValue {
  value: number;
  prefix: string;
  suffix: string;
  decimals: number;
  grouped: boolean;
}

/** "1,240", "98%", "PKR 1,000", "12.5 km" → parts; dates, times and "—" are not numbers. */
function parseNumeric(input: string | number | null | undefined): NumericValue | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const decimals = (String(input).split('.')[1] ?? '').length;
    return { value: input, prefix: '', suffix: '', decimals, grouped: Math.abs(input) >= 1000 };
  }
  const match = String(input ?? '').trim().match(/^([^\d-]*?)(-?\d[\d,]*(?:\.\d+)?)([^\d]*)$/);
  if (!match) return null;
  const [, prefix, number, suffix] = match;
  const value = Number(number.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { value, prefix, suffix, decimals: (number.split('.')[1] ?? '').length, grouped: number.includes(',') };
}

function format(value: number, parts: NumericValue): string {
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
    useGrouping: parts.grouped,
  });
  return `${parts.prefix}${number}${parts.suffix}`;
}

/**
 * Counts a metric from its previous value to the new one instead of jumping, and marks the host
 * with `data-trend="up|down"` for a moment so cards can flash the change. Non-numeric values are
 * written as-is. Runs outside Angular: one text write per frame, no change detection.
 */
@Directive({ selector: '[uiCountUp]' })
export class CountUp {
  readonly uiCountUp = input.required<string | number | null | undefined>();
  readonly countDuration = input(700);

  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private previous: number | null = null;
  private frame = 0;
  private trendTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const value = this.uiCountUp();
      untracked(() => this.render(value));
    });
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame);
      clearTimeout(this.trendTimer);
    });
  }

  private render(input: string | number | null | undefined): void {
    cancelAnimationFrame(this.frame);
    const parts = parseNumeric(input);
    if (!parts) {
      this.element.textContent = String(input ?? '');
      this.previous = null;
      return;
    }
    const from = this.previous ?? 0;
    const to = parts.value;
    if (this.previous !== null && from !== to) this.flagTrend(to > from ? 'up' : 'down');
    this.previous = to;
    if (this.reducedMotion || from === to) {
      this.element.textContent = format(to, parts);
      return;
    }
    const duration = this.countDuration();
    const start = performance.now();
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        this.element.textContent = format(progress < 1 ? from + (to - from) * eased : to, parts);
        if (progress < 1) this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    });
  }

  private flagTrend(trend: 'up' | 'down'): void {
    clearTimeout(this.trendTimer);
    this.element.dataset['trend'] = trend;
    this.trendTimer = setTimeout(() => delete this.element.dataset['trend'], 1200);
  }
}
