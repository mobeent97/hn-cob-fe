// The COB's chart data shapes and the adapters that turn them into inputs for IoTility's chart components
// (ui-bar-chart, ui-line-chart, ui-donut-chart from @iotility/shared-ui). Pages keep building the simple
// shapes below; the adapters pick the colours from the IoTility chart palette.
import { ChartPalette, ChartSeries, ChartSlice, ChartValueFormatter, lighten } from '@iotility/shared-ui';
import { cssColor } from '../ui/css-color';

export interface BarDatum {
  label: string;
  value: number;
  /** Shown in a lighter tone of the bar colour: a marked period, e.g. the current, incomplete month. */
  marked?: boolean;
}
export interface LinePoint {
  label: string;
  value: number;
}
export interface RingSegment {
  label: string;
  value: number;
  /** Any CSS colour, including token references such as var(--color-info). */
  colour: string;
}
export interface HBarRow {
  label: string;
  value: number;
  /** Text for the value (defaults to the number), e.g. "12.5%". */
  display?: string;
  /** Second, quieter figure appended to the label, e.g. "−3" or "5 of 120". */
  sub?: string;
}

export interface CategoryChart {
  categories: string[];
  series: ChartSeries[];
}

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
export const formatNumber: ChartValueFormatter = (v) => (Number.isFinite(v) ? nf.format(v) : '—');

/** One series in the brand colour; marked bars in a lighter tone of it. */
export function barChart(data: BarDatum[], name: string, palette: ChartPalette): CategoryChart {
  const marked = lighten(palette.brand, palette.dark ? 0.45 : 0.6);
  const hasMarked = data.some((d) => d.marked);
  return {
    categories: data.map((d) => d.label),
    series: [
      {
        name,
        data: data.map((d) => d.value),
        color: palette.brand,
        colors: hasMarked ? data.map((d) => (d.marked ? marked : palette.brand)) : undefined,
      },
    ],
  };
}

/** The main line in the brand colour, an optional comparison in the muted grid colour. */
export function lineChart(data: LinePoint[], compare: LinePoint[], names: [string, string], palette: ChartPalette): CategoryChart {
  const series: ChartSeries[] = [{ name: names[0], data: data.map((d) => d.value), color: palette.brand }];
  if (compare.length) series.push({ name: names[1], data: compare.map((d) => d.value), color: palette.text });
  return { categories: data.map((d) => d.label), series };
}

/** Ranked horizontal bars: the second figure joins the label, the display text becomes the value format. */
export function hbarChart(rows: HBarRow[], name: string, palette: ChartPalette): CategoryChart & { format: ChartValueFormatter } {
  const display = new Map(rows.filter((r) => r.display).map((r) => [r.value, r.display!]));
  return {
    categories: rows.map((r) => (r.sub ? `${r.label} (${r.sub})` : r.label)),
    series: [{ name, data: rows.map((r) => r.value), color: palette.brand }],
    format: (v) => display.get(v) ?? formatNumber(v),
  };
}

export function ringSlices(segments: RingSegment[]): ChartSlice[] {
  return segments.map((s) => ({ label: s.label, value: s.value, color: cssColor(s.colour) }));
}
