// Portal charts, drawn with Apache ECharts (SVG renderer) to the design rules in docs/DESIGN.md:
// one hue per chart, faint dashed gridlines, no axis lines, no legend for a single series,
// tabular figures, tokens for every colour (light and dark), updates that morph in place.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartTokens, EChart, tooltipBase } from './echart';

export interface BarDatum {
  label: string;
  value: number;
  /** Second tone for a marked period (e.g. the current, incomplete month). */
  marked?: boolean;
}
export interface LinePoint {
  label: string;
  value: number;
}
export interface RingSegment {
  label: string;
  value: number;
  colour: string;
}
export interface HBarRow {
  label: string;
  value: number;
  /** Text shown at the end of the bar (defaults to the value). */
  display?: string;
  /** Second, quieter figure in the tooltip and after the value (e.g. "−3", "5 of 120"). */
  sub?: string;
}

const short = (n: number) => (Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${+n.toFixed(2)}`);
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/** Shared axis styling: grey 12px labels, no lines, faint dashed splits. */
function axes(t: ChartTokens) {
  const label = { color: t.muted, fontFamily: t.font, fontSize: 12 };
  return {
    category: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...label, hideOverlap: true, margin: 10 } },
    value: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...label, formatter: short },
      splitLine: { lineStyle: { color: t.grid, type: [2, 3] as number[] } },
      splitNumber: 4,
    },
  };
}

/** Vertical bars: one hue, the marked (in-progress) period in a lighter tone of it. */
@Component({
  selector: 'app-bar-chart',
  imports: [EChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `<app-echart [option]="option()" [height]="height()" [label]="label()" />`,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly height = input(220);
  readonly label = input('Bar chart');
  /** Optional unit for the tooltip, e.g. "devices". */
  readonly unit = input('');

  protected readonly option = computed(() => {
    const data = this.data();
    const unit = this.unit();
    return (t: ChartTokens): EChartsCoreOption => {
      const a = axes(t);
      return {
        grid: { left: 4, right: 4, top: 12, bottom: 4, containLabel: true },
        tooltip: {
          ...tooltipBase(t),
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: t.text, opacity: 0.05 } },
          valueFormatter: (v: number) => `${nf.format(v)}${unit ? ' ' + unit : ''}`,
        },
        xAxis: { type: 'category', data: data.map((d) => d.label), ...a.category },
        yAxis: { type: 'value', ...a.value },
        series: [
          {
            type: 'bar',
            name: this.label(),
            barMaxWidth: 36,
            barCategoryGap: '40%',
            data: data.map((d) => ({
              value: d.value,
              itemStyle: { color: t.c1, opacity: d.marked ? 0.35 : 1, borderRadius: [2, 2, 0, 0] },
            })),
            // The hover shading under the bar is the feedback; the bar itself keeps its colour.
            emphasis: { disabled: true },
          },
        ],
      };
    };
  });
}

/** A 2px straight line (no markers except the last point), a 8% area tint, an optional dashed comparison. */
@Component({
  selector: 'app-line-chart',
  imports: [EChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `<app-echart [option]="option()" [height]="height()" [label]="label()" />`,
})
export class LineChart {
  readonly data = input.required<LinePoint[]>();
  readonly compare = input<LinePoint[]>([]);
  readonly height = input(220);
  readonly label = input('Line chart');
  /** Start the value axis near the data instead of at zero (e.g. voltages). */
  readonly scale = input(false);
  readonly names = input<[string, string]>(['This period', 'Comparison']);

  protected readonly option = computed(() => {
    const data = this.data();
    const compare = this.compare();
    const [nameA, nameB] = this.names();
    const scale = this.scale();
    return (t: ChartTokens): EChartsCoreOption => {
      const a = axes(t);
      const last = data.length - 1;
      return {
        grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
        tooltip: {
          ...tooltipBase(t),
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.border } },
          valueFormatter: (v: number) => nf.format(v),
        },
        xAxis: { type: 'category', boundaryGap: false, data: data.map((d) => d.label), ...a.category },
        yAxis: { type: 'value', scale, ...a.value },
        series: [
          ...(compare.length
            ? [{
                type: 'line', name: nameB, data: compare.map((d) => d.value), symbol: 'none', smooth: false,
                lineStyle: { color: t.c3, width: 1.5, type: [4, 4] as number[] }, itemStyle: { color: t.c3 }, z: 1,
              }]
            : []),
          {
            type: 'line',
            name: nameA,
            smooth: false,
            data: data.map((d, i) => ({
              value: d.value,
              symbol: i === last ? 'circle' : 'none',
              symbolSize: 7,
              itemStyle: { color: t.surface, borderColor: t.c1, borderWidth: 2 },
            })),
            showSymbol: true,
            lineStyle: { color: t.c1, width: 2 },
            itemStyle: { color: t.c1 },
            areaStyle: { color: t.c1, opacity: 0.08 },
            z: 2,
          },
        ],
      };
    };
  });
}

/** Thin ring with even gaps and no slice labels; the legend lives beside it as a table of values. */
@Component({
  selector: 'app-ring',
  imports: [EChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.display]': "'inline-block'", '[style.width.px]': 'size()' },
  template: `<app-echart [option]="option()" [height]="size()" [label]="label()" />`,
})
export class Ring {
  readonly segments = input.required<RingSegment[]>();
  readonly size = input(140);
  readonly label = input('Ring chart');

  protected readonly option = computed(() => {
    const segs = this.segments();
    return (t: ChartTokens): EChartsCoreOption => {
      const total = segs.reduce((s, x) => s + x.value, 0) || 1;
      return {
        tooltip: {
          ...tooltipBase(t),
          trigger: 'item',
          formatter: (p: { name: string; value: number }) =>
            `${p.name}<br/><b style="font-variant-numeric:tabular-nums">${nf.format(p.value)}</b> · ${((p.value / total) * 100).toFixed(1)}%`,
        },
        series: [
          {
            type: 'pie',
            radius: ['80%', '94%'],
            center: ['50%', '50%'],
            startAngle: 90,
            padAngle: segs.filter((s) => s.value > 0).length > 1 ? 2 : 0,
            avoidLabelOverlap: false,
            label: { show: false },
            labelLine: { show: false },
            emphasis: { scale: true, scaleSize: 3, label: { show: false } },
            itemStyle: { borderWidth: 0 },
            data: segs.map((s) => ({ name: s.label, value: s.value, itemStyle: { color: t.resolve(s.colour) } })),
          },
        ],
      };
    };
  });
}

/** Horizontal ranked bars with the label on the left and the figure at the end of each bar. */
@Component({
  selector: 'app-hbar-chart',
  imports: [EChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block' },
  template: `<app-echart [option]="option()" [height]="chartHeight()" [label]="label()" />`,
})
export class HBarChart {
  readonly rows = input.required<HBarRow[]>();
  readonly label = input('Bar chart');
  /** Height per row in px; the chart grows with the row count. */
  readonly rowHeight = input(34);
  /** Width reserved for the labels on the left. */
  readonly labelWidth = input(170);

  protected readonly chartHeight = computed(() => Math.max(80, this.rows().length * this.rowHeight() + 8));

  protected readonly option = computed(() => {
    const rows = this.rows();
    const lw = this.labelWidth();
    return (t: ChartTokens): EChartsCoreOption => ({
      grid: { left: lw, right: 150, top: 0, bottom: 0 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex];
          return `${r.label}<br/><b style="font-variant-numeric:tabular-nums">${r.display ?? nf.format(r.value)}</b>${r.sub ? ' · ' + r.sub : ''}`;
        },
      },
      xAxis: { type: 'value', show: false, max: (v: { max: number }) => v.max || 1 },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((r) => r.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 13, width: lw - 12, overflow: 'truncate', align: 'left', margin: lw - 4 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 8,
          showBackground: true,
          backgroundStyle: { color: t.raised, borderRadius: 4 },
          itemStyle: { color: t.c1, borderRadius: 4 },
          data: rows.map((r) => r.value),
          label: {
            show: true,
            position: 'right',
            distance: 10,
            color: t.text,
            fontFamily: t.font,
            fontSize: 13,
            formatter: (p: { dataIndex: number }) => {
              const r = rows[p.dataIndex];
              return `${r.display ?? nf.format(r.value)}${r.sub ? `{sub|  ${r.sub}}` : ''}`;
            },
            rich: { sub: { color: t.muted, fontSize: 12, fontFamily: t.font } },
          },
        },
      ],
    });
  });
}
