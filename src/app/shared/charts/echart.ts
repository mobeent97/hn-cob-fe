import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, untracked,
} from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart as EBar, LineChart as ELine, PieChart as EPie } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { Theme } from '../../core/theme/theme';

// Tree-shaken registration: only what the portal draws.
echarts.use([EBar, ELine, EPie, GridComponent, TooltipComponent, MarkLineComponent, AriaComponent, SVGRenderer]);

/** Design tokens resolved for ECharts (it can't read CSS variables). Re-read on every theme change. */
export interface ChartTokens {
  c1: string; c2: string; c3: string; c4: string;
  grid: string; text: string; muted: string; surface: string; border: string; raised: string;
  negative: string; font: string;
  /** Resolve any colour string, including `var(--token)`. */
  resolve(c: string): string;
}

export function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const resolve = (c: string): string => {
    const m = c.match(/^var\((--[\w-]+)\)$/);
    if (!m) return c;
    const r = cs.getPropertyValue(m[1]).trim();
    return r.startsWith('var(') ? resolve(r) : r || c;
  };
  return {
    c1: resolve(v('--chart-1', '#0a6f96')), c2: v('--chart-2', '#a86f0c'), c3: v('--chart-3', '#8a96a0'), c4: v('--chart-4', '#c9d1d7'),
    grid: v('--grid', '#e6e9ec'), text: v('--text', '#121417'), muted: v('--muted', '#565b61'),
    surface: v('--surface', '#ffffff'), border: v('--border', '#e4e8eb'), raised: v('--raised', '#f6f8f9'),
    negative: v('--negative', '#c4242a'), font: v('--font', 'IBM Plex Sans, sans-serif'),
    resolve,
  };
}

/** Tooltip styled like the portal's popovers. */
export function tooltipBase(t: ChartTokens) {
  return {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
    extraCssText: 'box-shadow: var(--shadow-float); border-radius: 8px;',
    confine: true,
  };
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Hosts one ECharts instance. Give it an `option` builder that receives the current tokens;
 * it re-renders when the option changes (data morphs in place) and when the theme switches.
 * No entrance animation on first paint (app screens don't perform entrances); updates animate.
 */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block;width:100%', role: 'img', '[attr.aria-label]': 'label()' },
  template: '',
})
export class EChart {
  readonly option = input.required<(t: ChartTokens) => EChartsCoreOption>();
  readonly height = input(220);
  readonly label = input('Chart');

  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly theme = inject(Theme);
  private chart: echarts.ECharts | null = null;
  private first = true;

  constructor() {
    afterNextRender(() => {
      this.el.style.height = `${this.height()}px`;
      this.chart = echarts.init(this.el, null, { renderer: 'svg' });
      this.render(true);
      const ro = new ResizeObserver(() => this.chart?.resize());
      ro.observe(this.el);
      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        this.chart?.dispose();
        this.chart = null;
      });
    });
    effect(() => {
      this.option();
      this.theme.version(); // re-read tokens on a light/dark switch
      this.el.style.height = `${this.height()}px`;
      untracked(() => this.render(false));
    });
  }

  private readonly destroyRef = inject(DestroyRef);

  private render(initial: boolean) {
    if (!this.chart) return;
    const opt = this.option()(readTokens());
    const motion = !reduceMotion();
    this.chart.setOption(
      {
        animation: motion,
        animationDuration: initial || this.first ? 0 : 450,
        animationDurationUpdate: 450,
        animationEasingUpdate: 'cubicOut',
        aria: { enabled: true, label: { description: this.label() } },
        ...opt,
      },
      // Merge (not replace) so bars and lines morph from their old values to the new ones.
      { lazyUpdate: true },
    );
    this.first = false;
  }
}
