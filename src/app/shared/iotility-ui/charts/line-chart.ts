import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ChartCanvas, ChartOption } from './chart-canvas';
import {
  ChartSeries,
  ChartTheme,
  ChartValueFormatter,
  axisStyle,
  axisTooltip,
  baseOption,
  defaultFormat,
  linearGradient,
  mergeOption,
  tooltipBase,
  withAlpha,
} from './chart-theme';

/** Smooth line chart with glowing strokes and gradient area fills. */
@Component({
  selector: 'ui-line-chart',
  imports: [ChartCanvas],
  template: '<ui-chart-canvas [option]="option()" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: block; width: 100%; height: 100%; min-height: 0; }',
})
export class LineChart {
  readonly categories = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  /** Gradient fill under each line. */
  readonly area = input(true);
  readonly smooth = input(true);
  readonly stacked = input(false);
  /** Legend inside the chart (bottom). Off when the card header shows it. */
  readonly legend = input(true);
  /** Always show data points; otherwise they appear on hover. */
  readonly showPoints = input(false);
  readonly valueFormatter = input<ChartValueFormatter>(defaultFormat);
  /** Escape hatch for one-off ECharts tweaks, deep-merged last. */
  readonly overrides = input<ChartOption | undefined>(undefined);

  private readonly theme = inject(ChartTheme);

  protected readonly option = computed<ChartOption>(() => {
    const palette = this.theme.palette();
    const format = this.valueFormatter();
    const legend = this.legend();
    const base = baseOption(palette, this.theme.reducedMotion);
    return mergeOption(
      {
        ...base,
        legend: legend ? base.legend : { show: false },
        grid: { left: 4, right: 14, top: 14, bottom: legend ? 34 : 4, containLabel: true },
        tooltip: {
          ...tooltipBase(palette),
          trigger: 'axis',
          formatter: axisTooltip(palette, format),
          // A soft glowing crosshair in the brand colour follows the cursor across the plot.
          axisPointer: {
            type: 'line',
            lineStyle: { color: withAlpha(palette.brand, 0.55), width: 1.5, shadowBlur: 8, shadowColor: withAlpha(palette.brand, 0.6) },
          },
        },
        xAxis: { type: 'category', data: this.categories(), boundaryGap: false, ...axisStyle(palette, 'category') },
        yAxis: {
          type: 'value',
          ...axisStyle(palette, 'value'),
          axisLabel: { ...axisStyle(palette, 'value').axisLabel, formatter: (value: number) => format(value) },
        },
        series: this.series().map((item, index) => {
          const color = this.theme.seriesColor(index, item.color);
          return {
            id: item.name,
            name: item.name,
            type: 'line',
            data: item.data,
            smooth: this.smooth() ? 0.35 : false,
            stack: this.stacked() ? 'total' : undefined,
            symbol: 'circle',
            symbolSize: 7,
            showSymbol: this.showPoints(),
            lineStyle: { width: 2.5, color, shadowColor: withAlpha(color, 0.3), shadowBlur: 10, shadowOffsetY: 6 },
            itemStyle: { color, borderColor: palette.surface, borderWidth: 2 },
            areaStyle: this.area()
              ? { color: linearGradient(withAlpha(color, this.stacked() ? 0.38 : 0.28), withAlpha(color, 0)) }
              : undefined,
            emphasis: { focus: 'series', lineStyle: { width: 3 } },
          };
        }),
      },
      this.overrides() as Record<string, unknown> | undefined,
    );
  });
}
