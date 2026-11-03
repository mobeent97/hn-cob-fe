import { Injectable, computed, signal } from '@angular/core';

/** One line/bar series. `colors` (bar charts) overrides the colour per data point. */
export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color?: string;
  colors?: string[];
}

/** One donut/pie slice. */
export interface ChartSlice {
  label: string;
  value: number;
  color?: string;
}

/** Item for a legend rendered by ChartCard in its header. */
export interface ChartLegendItem {
  label: string;
  color: string;
}

export type ChartValueFormatter = (value: number) => string;

/** Theme colours resolved to rgb()/rgba(), which canvas renderers can parse (design tokens are oklch). */
export interface ChartPalette {
  dark: boolean;
  brand: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  /** Axis labels and legend text. */
  text: string;
  /** Split lines and axis lines. */
  grid: string;
  /** Card background, used for slice gaps and point outlines. */
  surface: string;
  tooltipBg: string;
  tooltipFg: string;
  fontFamily: string;
  /** Distinct colours for multi-series charts, in order. */
  series: string[];
}

const SERIES_TOKENS: [string, string][] = [
  ['--color-brand-500', '#8b5cf6'],
  ['--color-info', '#3978d4'],
  ['--color-success', '#21a179'],
  ['--color-warning', '#e7a92d'],
  ['--color-danger', '#e05252'],
  ['--color-sky-500', '#0ea5e9'],
  ['--color-pink-600', '#db2777'],
  ['--color-lime-600', '#65a30d'],
  ['--color-orange-600', '#ea580c'],
  ['--color-indigo-600', '#4f46e5'],
  ['--color-cyan-600', '#0891b2'],
  ['--color-amber-600', '#ca8a04'],
];

let probe: CanvasRenderingContext2D | null = null;

/** Normalises any CSS colour (including oklch) to rgb()/rgba() by painting one pixel. */
export function toRgb(color: string, fallback = '#8b5cf6'): string {
  if (typeof document === 'undefined') return fallback;
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
    willReadFrequently: true,
  });
  if (!probe || !color) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function channels(color: string): [number, number, number, number] {
  const values = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
}

export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = channels(toRgb(color));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mixes a colour towards white (amount 0–1). */
export function lighten(color: string, amount: number): string {
  const [r, g, b] = channels(toRgb(color));
  const mix = (value: number) => Math.round(value + (255 - value) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Linear gradient in ECharts' plain-object form (no runtime import needed). */
export function linearGradient(from: string, to: string, direction: 'vertical' | 'horizontal' = 'vertical') {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: direction === 'horizontal' ? 1 : 0,
    y2: direction === 'vertical' ? 1 : 0,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

/** First solid colour of a plain colour or a gradient object. */
export function solidColor(color: unknown, fallback: string): string {
  if (typeof color === 'string') return color;
  const stops = (color as { colorStops?: { color: string }[] } | null)?.colorStops;
  return stops?.[0]?.color ?? fallback;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function defaultFormat(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

function tooltipRow(color: string, name: string, value: string): string {
  return (
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;line-height:1.7">` +
    `<span style="display:inline-flex;align-items:center;gap:7px;opacity:.85">` +
    `<i style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block"></i>${escapeHtml(name)}</span>` +
    `<b style="font-weight:600">${escapeHtml(value)}</b></div>`
  );
}

interface TooltipParam {
  seriesName?: string;
  name?: string;
  value?: unknown;
  color?: unknown;
  percent?: number;
  axisValueLabel?: string;
}

/** Axis tooltip: the category as a heading, then one row per series. */
export function axisTooltip(palette: ChartPalette, format: ChartValueFormatter) {
  return (params: TooltipParam | TooltipParam[]) => {
    const list = Array.isArray(params) ? params : [params];
    const heading = list[0]?.axisValueLabel ?? list[0]?.name ?? '';
    const rows = list
      .filter((item) => item.value !== null && item.value !== undefined && item.value !== '-')
      .map((item) => tooltipRow(solidColor(item.color, palette.brand), item.seriesName ?? '', format(Number(item.value))))
      .join('');
    return `<div style="font-size:11px;opacity:.65;margin-bottom:4px">${escapeHtml(heading)}</div>${rows}`;
  };
}

/** Item tooltip for slices: name, value and share. */
export function itemTooltip(palette: ChartPalette, format: ChartValueFormatter) {
  return (params: TooltipParam) =>
    tooltipRow(
      solidColor(params.color, palette.brand),
      params.name ?? '',
      `${format(Number(params.value))}${params.percent !== undefined ? `  ·  ${params.percent}%` : ''}`,
    );
}

/** Tooltip chrome shared by every chart, matching the app's tooltip directive. */
export function tooltipBase(palette: ChartPalette) {
  return {
    backgroundColor: palette.tooltipBg,
    borderWidth: 0,
    padding: [8, 11],
    textStyle: { color: palette.tooltipFg, fontSize: 12, fontFamily: palette.fontFamily },
    extraCssText: `border-radius:9px;box-shadow:0 1px 2px rgba(15,17,25,.2),0 10px 24px -6px rgba(15,17,25,.4);`,
    confine: true,
    transitionDuration: 0.18,
  };
}

/** Options every chart starts from: animation, typography and legend style. */
export function baseOption(palette: ChartPalette, reducedMotion: boolean) {
  return {
    backgroundColor: 'transparent',
    // Draw-in on first render, then values glide between updates instead of redrawing.
    animation: !reducedMotion,
    animationDuration: 700,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicInOut',
    textStyle: { fontFamily: palette.fontFamily, color: palette.text },
    // One line that pages with arrows when it overflows, so it never wraps into the axis labels.
    legend: {
      type: 'scroll',
      bottom: 0,
      icon: 'circle',
      pageIconColor: palette.text,
      pageIconInactiveColor: withAlpha(palette.text, 0.3),
      pageIconSize: 9,
      pageTextStyle: { color: palette.text, fontSize: 10 },
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
      textStyle: { color: palette.text, fontSize: 11 },
      inactiveColor: withAlpha(palette.text, 0.35),
    },
  };
}

/** Category/value axis styling shared by line and bar charts. */
export function axisStyle(palette: ChartPalette, kind: 'category' | 'value') {
  return kind === 'category'
    ? {
        axisLine: { show: true, lineStyle: { color: palette.grid } },
        axisTick: { show: false },
        axisLabel: { color: palette.text, fontSize: 11, margin: 10, hideOverlap: true },
        splitLine: { show: false },
      }
    : {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.text, fontSize: 11, margin: 10 },
        splitLine: { show: true, lineStyle: { color: palette.grid, type: [4, 4] as number[] } },
      };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Deep-merges per-chart `overrides` into a built option; arrays and primitives are replaced. */
export function mergeOption(base: Record<string, unknown>, overrides?: Record<string, unknown>): Record<string, unknown> {
  if (!overrides) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? mergeOption(current, value) : value;
  }
  return merged;
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function resolvePalette(dark: boolean): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => toRgb(styles.getPropertyValue(name).trim() || fallback, fallback);
  return {
    dark,
    brand: token('--color-brand-500', '#8b5cf6'),
    info: token('--color-info', '#3978d4'),
    success: token('--color-success', '#21a179'),
    warning: token('--color-warning', '#e7a92d'),
    danger: token('--color-danger', '#e05252'),
    text: dark ? token('--color-brand-300', '#c4b5fd') : token('--color-muted', '#6b7280'),
    grid: dark ? token('--color-dark-line', '#2b2e3b') : token('--color-line', '#e6e8ef'),
    surface: dark ? token('--color-dark-surface', '#14151c') : '#ffffff',
    tooltipBg: dark ? '#2a2d3a' : '#16181f',
    tooltipFg: '#f5f6fa',
    fontFamily: getComputedStyle(document.body).fontFamily || 'inherit',
    series: SERIES_TOKENS.map(([name, fallback]) => token(name, fallback)),
  };
}

/** Resolved chart palette that follows the app's light/dark switch (the `dark` class on <html>). */
@Injectable({ providedIn: 'root' })
export class ChartTheme {
  private readonly darkMode = signal(isDark());
  readonly palette = computed(() => resolvePalette(this.darkMode()));
  readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => this.darkMode.set(isDark())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  /** Colour for the n-th series: explicit colour first, then the palette in order. */
  seriesColor(index: number, explicit?: string): string {
    if (explicit) return toRgb(explicit);
    const series = this.palette().series;
    return series[index % series.length];
  }
}
