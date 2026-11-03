import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ChartCanvas, ChartOption } from './chart-canvas';
import {
  ChartSlice,
  ChartTheme,
  ChartValueFormatter,
  baseOption,
  defaultFormat,
  itemTooltip,
  lighten,
  linearGradient,
  mergeOption,
  tooltipBase,
} from './chart-theme';

/** Donut (or pie) with padded rounded slices, a sweep-in, and the total in the middle. */
@Component({
  selector: 'ui-donut-chart',
  imports: [ChartCanvas],
  template: `
    <ui-chart-canvas [option]="option()" />
    @if (!pie() && showTotal()) {
      <div class="center" [style.top]="centerY()" aria-hidden="true">
        <strong>{{ valueFormatter()(total()) }}</strong>
        <span>{{ centerLabel() }}</span>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: relative; display: block; width: 100%; height: 100%; min-height: 0; }
    .center {
      position: absolute;
      left: 50%;
      display: grid;
      justify-items: center;
      gap: 2px;
      transform: translate(-50%, -50%);
      pointer-events: none;
      text-align: center;
    }
    .center strong { font-size: 20px; font-weight: 700; line-height: 1.1; color: var(--color-ink); }
    .center span { font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
    :host-context(.dark) .center strong { color: #fff; }
    :host-context(.dark) .center span { color: var(--color-brand-300); }
  `,
})
export class DonutChart {
  readonly slices = input.required<ChartSlice[]>();
  /** Full pie instead of a ring. */
  readonly pie = input(false);
  /** Legend inside the chart (bottom). Off when the card header shows it. */
  readonly legend = input(true);
  readonly showTotal = input(true);
  readonly centerLabel = input('Total');
  readonly valueFormatter = input<ChartValueFormatter>(defaultFormat);
  /** Escape hatch for one-off ECharts tweaks, deep-merged last. */
  readonly overrides = input<ChartOption | undefined>(undefined);

  private readonly theme = inject(ChartTheme);

  protected readonly total = computed(() => this.slices().reduce((sum, slice) => sum + (Number(slice.value) || 0), 0));
  /** Keep the ring centred in the space above the legend. */
  protected readonly centerY = computed(() => (this.legend() ? '44%' : '50%'));

  protected readonly option = computed<ChartOption>(() => {
    const palette = this.theme.palette();
    const pie = this.pie();
    const legend = this.legend();
    const base = baseOption(palette, this.theme.reducedMotion);
    return mergeOption(
      {
        ...base,
        legend: legend ? base.legend : { show: false },
        tooltip: { ...tooltipBase(palette), trigger: 'item', formatter: itemTooltip(palette, this.valueFormatter()) },
        series: [
          {
            id: 'slices',
            type: 'pie',
            center: ['50%', this.centerY()],
            radius: pie ? [0, '74%'] : ['58%', '80%'],
            padAngle: pie ? 0 : 2,
            minAngle: 3,
            avoidLabelOverlap: true,
            label: { show: false },
            labelLine: { show: false },
            itemStyle: { borderRadius: pie ? 4 : 7, borderColor: palette.surface, borderWidth: pie ? 2 : 0 },
            emphasis: {
              scale: true,
              scaleSize: 6,
              itemStyle: { shadowBlur: 18, shadowColor: 'rgba(15, 17, 25, 0.22)' },
            },
            data: this.slices().map((slice, index) => {
              const color = this.theme.seriesColor(index, slice.color);
              return {
                name: slice.label,
                value: slice.value,
                itemStyle: { color: linearGradient(lighten(color, 0.2), color) },
              };
            }),
          },
        ],
      },
      this.overrides() as Record<string, unknown> | undefined,
    );
  });
}
