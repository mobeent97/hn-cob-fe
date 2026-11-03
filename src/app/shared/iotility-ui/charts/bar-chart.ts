import { ChangeDetectionStrategy, Component, computed, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ChartCanvas, ChartOption, ChartZoomRange } from './chart-canvas';
import {
  ChartSeries,
  ChartTheme,
  ChartValueFormatter,
  axisStyle,
  axisTooltip,
  baseOption,
  defaultFormat,
  lighten,
  linearGradient,
  mergeOption,
  toRgb,
  tooltipBase,
  withAlpha,
} from './chart-theme';

/**
 * Rounded gradient bars: vertical or horizontal, grouped or stacked, with a staggered grow-in.
 * Past `maxVisible` categories the chart shows a window of them with a slim scrollbar
 * (arrows, draggable thumb, "1–12 of N"), so large datasets stay readable.
 */
@Component({
  selector: 'ui-bar-chart',
  imports: [ChartCanvas],
  templateUrl: './bar-chart.html',
  styleUrl: './bar-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarChart {
  readonly categories = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly horizontal = input(false);
  readonly stacked = input(false);
  /** Legend inside the chart (bottom). Off when the card header shows it. */
  readonly legend = input(true);
  /**
   * Faint full-length track behind each bar (single, unstacked series only). Only meaningful when
   * the value axis has a real maximum (e.g. percentages); otherwise it implies a false "full" level.
   */
  readonly track = input(false);
  /** Max bar thickness in px; by default wider when there are only a few categories. */
  readonly barMaxWidth = input<number | null>(null);
  /**
   * Most categories shown at once. Beyond this the chart shows a window of them that scrolls
   * (scrollbar, dragging the plot or Shift+wheel). 0 = show all.
   */
  readonly maxVisible = input(12);
  readonly valueFormatter = input<ChartValueFormatter>(defaultFormat);
  /** Escape hatch for one-off ECharts tweaks, deep-merged last. */
  readonly overrides = input<ChartOption | undefined>(undefined);

  private readonly theme = inject(ChartTheme);
  private readonly canvas = viewChild(ChartCanvas);

  protected readonly total = computed(() => this.categories().length);
  protected readonly windowSize = computed(() => this.maxVisible());
  protected readonly scroll = computed(() => this.windowSize() > 0 && this.total() > this.windowSize());
  private readonly lastStart = computed(() => Math.max(0, this.total() - this.windowSize()));
  private readonly requestedStart = signal(0);
  /** First visible category, kept in range when the data shrinks. */
  protected readonly start = computed(() => Math.min(this.requestedStart(), this.lastStart()));
  protected readonly end = computed(() => Math.min(this.total(), this.start() + this.windowSize()) - 1);
  /** Thumb size (share of the list in view) and position (0 → 1) for the scrollbar. */
  protected readonly thumbRatio = computed(() => Math.min(1, this.windowSize() / Math.max(1, this.total())));
  protected readonly thumbPosition = computed(() => (this.lastStart() ? this.start() / this.lastStart() : 0));

  protected readonly option = computed<ChartOption>(() => {
    const palette = this.theme.palette();
    const format = this.valueFormatter();
    const horizontal = this.horizontal();
    const stacked = this.stacked();
    const series = this.series();
    const legend = this.legend();
    const base = baseOption(palette, this.theme.reducedMotion);
    const scroll = this.scroll();
    const visible = scroll ? this.windowSize() : this.total();
    const radius = 6;
    // Rounded at the bar's end; in a stack only the outermost segment is rounded.
    const endRadius = horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0];
    const fill = (color: string) =>
      horizontal
        ? linearGradient(lighten(color, 0.28), color, 'horizontal')
        : linearGradient(lighten(color, 0.24), color);

    const categoryAxis = {
      type: 'category',
      data: this.categories(),
      ...axisStyle(palette, 'category'),
      axisLabel: horizontal
        ? { ...axisStyle(palette, 'category').axisLabel, width: 110, overflow: 'truncate', hideOverlap: false }
        : { ...axisStyle(palette, 'category').axisLabel, interval: 0, width: 76, overflow: 'break', lineHeight: 13 },
      inverse: horizontal,
    };
    const valueAxis = {
      type: 'value',
      ...axisStyle(palette, 'value'),
      axisLabel: { ...axisStyle(palette, 'value').axisLabel, formatter: (value: number) => format(value) },
    };
    // Re-rendering for new data keeps the current window rather than jumping back to the start.
    const startValue = untracked(this.start);

    return mergeOption(
      {
        ...base,
        legend: legend ? base.legend : { show: false },
        grid: { left: 4, right: 14, top: 14, bottom: legend ? 34 : 4, containLabel: true },
        // The window itself; the visible scrollbar is HTML (see template) and drives it.
        dataZoom: scroll
          ? [
              {
                type: 'inside',
                ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }),
                startValue,
                endValue: startValue + this.windowSize() - 1,
                zoomLock: true,
                zoomOnMouseWheel: false,
                moveOnMouseWheel: 'shift',
                moveOnMouseMove: true,
              },
            ]
          : [],
        tooltip: {
          ...tooltipBase(palette),
          trigger: 'axis',
          formatter: axisTooltip(palette, format),
          axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(palette.brand, palette.dark ? 0.1 : 0.06) } },
        },
        xAxis: horizontal ? valueAxis : categoryAxis,
        yAxis: horizontal ? categoryAxis : valueAxis,
        series: series.map((item, index) => {
          const color = this.theme.seriesColor(index, item.color);
          const rounded = !stacked || index === series.length - 1;
          return {
            id: item.name,
            name: item.name,
            type: 'bar',
            stack: stacked ? 'total' : undefined,
            barMaxWidth: this.barMaxWidth() ?? (visible <= 4 ? 44 : visible <= 8 ? 32 : 24),
            barGap: '18%',
            barCategoryGap: '36%',
            showBackground: this.track() && !stacked && series.length === 1,
            backgroundStyle: { color: withAlpha(palette.grid, palette.dark ? 0.35 : 0.5), borderRadius: endRadius },
            itemStyle: { color: fill(color), borderRadius: rounded ? endRadius : 0 },
            data: item.colors
              ? item.data.map((value, point) => ({
                  value,
                  itemStyle: { color: fill(toRgb(item.colors![point] ?? color)) },
                }))
              : item.data,
            emphasis: {
              focus: series.length > 1 ? 'series' : 'none',
              itemStyle: { shadowBlur: 14, shadowColor: withAlpha(color, 0.35) },
            },
            // Stagger only the first screenful; off-screen bars don't hold up the entrance.
            animationDelay: (point: number) => Math.min(point, visible) * 40 + index * 60,
          };
        }),
      },
      this.overrides() as Record<string, unknown> | undefined,
    );
  });

  /** The chart was panned (drag or Shift+wheel): follow it with the scrollbar. */
  protected onZoom(range: ChartZoomRange): void {
    this.requestedStart.set(Math.round(range.startValue));
  }

  /** Previous/next screenful. */
  protected page(direction: -1 | 1): void {
    this.goTo(this.start() + direction * this.windowSize());
  }

  /** Clicking the track jumps a screenful towards the click; the thumb itself drags. */
  protected onTrackPointerDown(event: PointerEvent, track: HTMLElement): void {
    const thumb = (event.target as HTMLElement).closest('.thumb');
    if (thumb) {
      this.dragThumb(event, track);
      return;
    }
    const box = track.getBoundingClientRect();
    const thumbBox = track.querySelector('.thumb')!.getBoundingClientRect();
    const before = this.horizontal() ? event.clientY < thumbBox.top : event.clientX < thumbBox.left;
    if (box.width || box.height) this.page(before ? -1 : 1);
  }

  /** Keyboard support for the scrollbar (it is focusable, role="scrollbar"). */
  protected onKeydown(event: KeyboardEvent): void {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowUp: -1,
      ArrowRight: 1,
      ArrowDown: 1,
      PageUp: -this.windowSize(),
      PageDown: this.windowSize(),
    };
    if (event.key === 'Home') this.goTo(0);
    else if (event.key === 'End') this.goTo(this.lastStart());
    else if (event.key in step) this.goTo(this.start() + step[event.key]);
    else return;
    event.preventDefault();
  }

  private dragThumb(event: PointerEvent, track: HTMLElement): void {
    event.preventDefault();
    const thumb = event.target as HTMLElement;
    thumb.setPointerCapture(event.pointerId);
    const vertical = this.horizontal();
    const box = track.getBoundingClientRect();
    const thumbBox = thumb.getBoundingClientRect();
    const travel = (vertical ? box.height - thumbBox.height : box.width - thumbBox.width) || 1;
    const origin = vertical ? event.clientY : event.clientX;
    const fromPosition = this.thumbPosition();
    const move = (moveEvent: PointerEvent) => {
      const delta = (vertical ? moveEvent.clientY : moveEvent.clientX) - origin;
      const position = Math.min(1, Math.max(0, fromPosition + delta / travel));
      this.goTo(Math.round(position * this.lastStart()));
    };
    const stop = () => {
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', stop);
      thumb.removeEventListener('pointercancel', stop);
      thumb.classList.remove('dragging');
    };
    thumb.classList.add('dragging');
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', stop);
    thumb.addEventListener('pointercancel', stop);
  }

  private goTo(start: number): void {
    const next = Math.min(this.lastStart(), Math.max(0, start));
    if (next === this.start()) return;
    this.requestedStart.set(next);
    this.canvas()?.dispatchZoom({ startValue: next, endValue: next + this.windowSize() - 1 });
  }
}
