import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal,
} from '@angular/core';

/** Width of the host, tracked so SVG text never scales with the viewBox. */
function useWidth() {
  const el = inject(ElementRef<HTMLElement>).nativeElement;
  const w = signal(600);
  const ro = new ResizeObserver(([e]) => w.set(Math.max(120, Math.round(e.contentRect.width))));
  ro.observe(el);
  inject(DestroyRef).onDestroy(() => ro.disconnect());
  return w;
}

/** Round tick values just above the maximum: 3-5 faint lines, no axis line. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}
const short = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`);

export interface BarDatum {
  label: string;
  value: number;
  /** Second tone for a marked period (e.g. the current, incomplete month). */
  marked?: boolean;
}

@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `
    <svg [attr.width]="width()" [attr.height]="height()" role="img" [attr.aria-label]="label()">
      @for (t of yTicks(); track t) {
        <line class="grid" [attr.x1]="padL" [attr.x2]="width()" [attr.y1]="y(t)" [attr.y2]="y(t)" />
        <text class="tick" [attr.x]="padL - 8" [attr.y]="y(t) + 4" text-anchor="end">{{ short(t) }}</text>
      }
      @for (d of data(); track d.label; let i = $index) {
        <g>
          <rect
            class="bar"
            [class.marked]="d.marked"
            [attr.x]="bx(i)"
            [attr.width]="bw()"
            [style.y.px]="y(d.value)"
            [style.height.px]="plotBottom() - y(d.value)"
            rx="2"
          >
            <title>{{ d.label }}: {{ d.value }}</title>
          </rect>
          @if (showLabel(i)) {
            <text class="tick" [attr.x]="bx(i) + bw() / 2" [attr.y]="height() - 4" text-anchor="middle">{{ d.label }}</text>
          }
        </g>
      }
    </svg>
  `,
  styles: `
    svg { overflow: visible; }
    .grid { stroke: var(--grid); stroke-width: 1; stroke-dasharray: 2 3; }
    .tick { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .bar { fill: var(--chart-1); transition: y var(--duration-medium) var(--ease-out), height var(--duration-medium) var(--ease-out); }
    .bar.marked { fill: var(--chart-1); fill-opacity: 0.35; }
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly height = input(220);
  readonly label = input('Bar chart');
  protected readonly width = useWidth();
  protected readonly padL = 36;
  protected readonly short = short;
  protected readonly yTicks = computed(() => ticks(Math.max(...this.data().map((d) => d.value), 1)));
  protected readonly plotBottom = computed(() => this.height() - 24);
  protected readonly bw = computed(() => {
    const n = this.data().length;
    const slot = (this.width() - this.padL) / n;
    return Math.max(4, Math.min(36, slot * 0.6));
  });
  protected y(v: number) {
    const top = this.yTicks().at(-1)!;
    return 8 + (1 - v / top) * (this.plotBottom() - 8);
  }
  protected bx(i: number) {
    const slot = (this.width() - this.padL) / this.data().length;
    return this.padL + slot * i + (slot - this.bw()) / 2;
  }
  protected showLabel(i: number) {
    const n = this.data().length;
    const every = this.width() < 420 ? Math.ceil(n / 4) : n > 14 ? 2 : 1;
    return i % every === 0 || i === n - 1;
  }
}

export interface LinePoint {
  label: string;
  value: number;
}

@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `
    <svg [attr.width]="width()" [attr.height]="height()" role="img" [attr.aria-label]="label()">
      @for (t of yTicks(); track t) {
        <line class="grid" [attr.x1]="padL" [attr.x2]="width()" [attr.y1]="y(t)" [attr.y2]="y(t)" />
        <text class="tick" [attr.x]="padL - 8" [attr.y]="y(t) + 4" text-anchor="end">{{ short(t) }}</text>
      }
      @if (compare().length) {
        <path class="line compare" [attr.d]="path(compare())" />
      }
      <path class="area" [attr.d]="area()" />
      <path class="line" [attr.d]="path(data())" />
      @for (p of data(); track p.label; let i = $index) {
        @if (showLabel(i)) {
          <text class="tick" [attr.x]="x(i)" [attr.y]="height() - 4" text-anchor="middle">{{ p.label }}</text>
        }
      }
      <circle class="end" [attr.cx]="x(data().length - 1)" [attr.cy]="y(data().at(-1)?.value ?? 0)" r="3.5" />
    </svg>
  `,
  styles: `
    svg { overflow: visible; }
    .grid { stroke: var(--grid); stroke-dasharray: 2 3; }
    .tick { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .line { fill: none; stroke: var(--chart-1); stroke-width: 2; stroke-linejoin: round; transition: d var(--duration-medium) var(--ease-out); }
    .line.compare { stroke: var(--chart-3); stroke-dasharray: 4 4; stroke-width: 1.5; }
    .area { fill: var(--chart-1); fill-opacity: 0.08; transition: d var(--duration-medium) var(--ease-out); }
    .end { fill: var(--surface); stroke: var(--chart-1); stroke-width: 2; transition: cx var(--duration-medium) var(--ease-out), cy var(--duration-medium) var(--ease-out); }
  `,
})
export class LineChart {
  readonly data = input.required<LinePoint[]>();
  readonly compare = input<LinePoint[]>([]);
  readonly height = input(220);
  readonly label = input('Line chart');
  protected readonly width = useWidth();
  protected readonly padL = 36;
  protected readonly short = short;
  protected readonly yTicks = computed(() =>
    ticks(Math.max(...this.data().map((d) => d.value), ...this.compare().map((d) => d.value), 1)),
  );
  protected x(i: number) {
    const n = this.data().length;
    return this.padL + 6 + ((this.width() - this.padL - 12) * i) / Math.max(1, n - 1);
  }
  protected y(v: number) {
    const top = this.yTicks().at(-1)!;
    return 8 + (1 - v / top) * (this.height() - 32);
  }
  protected path(pts: LinePoint[]) {
    return pts.map((p, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)},${this.y(p.value).toFixed(1)}`).join(' ');
  }
  protected area() {
    const pts = this.data();
    if (!pts.length) return '';
    const base = this.y(0);
    return `${this.path(pts)} L${this.x(pts.length - 1).toFixed(1)},${base} L${this.x(0).toFixed(1)},${base} Z`;
  }
  protected showLabel(i: number) {
    const n = this.data().length;
    const every = this.width() < 420 ? Math.ceil(n / 4) : Math.ceil(n / 8);
    return i % every === 0 || i === n - 1;
  }
}

export interface RingSegment {
  label: string;
  value: number;
  colour: string;
}

/** Thin ring with even gaps; the legend lives beside it as a table of values. */
@Component({
  selector: 'app-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-block' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="'0 0 ' + size() + ' ' + size()" role="img" [attr.aria-label]="label()">
      <circle class="track" [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()" />
      @for (s of arcs(); track s.label) {
        <circle
          class="seg"
          [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()"
          [attr.stroke]="s.colour"
          [style.stroke-dasharray]="s.len + ' ' + circ()"
          [style.stroke-dashoffset]="-s.offset"
        ><title>{{ s.label }}: {{ s.value }}</title></circle>
      }
    </svg>
  `,
  styles: `
    svg { transform: rotate(-90deg); }
    .track { fill: none; stroke: var(--active); stroke-width: 10; }
    .seg { fill: none; stroke-width: 10; stroke-linecap: butt;
      transition: stroke-dasharray var(--duration-medium) var(--ease-out), stroke-dashoffset var(--duration-medium) var(--ease-out); }
  `,
})
export class Ring {
  readonly segments = input.required<RingSegment[]>();
  readonly size = input(140);
  readonly label = input('Ring chart');
  protected readonly c = computed(() => this.size() / 2);
  protected readonly r = computed(() => this.size() / 2 - 8);
  protected readonly circ = computed(() => 2 * Math.PI * this.r());
  protected readonly arcs = computed(() => {
    const segs = this.segments().filter((s) => s.value > 0);
    const total = segs.reduce((a, s) => a + s.value, 0) || 1;
    const gap = segs.length > 1 ? 3 : 0;
    let offset = 0;
    return segs.map((s) => {
      const full = (s.value / total) * this.circ();
      const arc = { ...s, len: Math.max(0.5, full - gap), offset };
      offset += full;
      return arc;
    });
  });
}
