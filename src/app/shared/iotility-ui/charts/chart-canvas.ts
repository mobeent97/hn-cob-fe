import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';

export type ChartOption = EChartsCoreOption;

/** Visible category range after the user pans a zoomable chart (indexes, inclusive). */
export interface ChartZoomRange {
  startValue: number;
  endValue: number;
}

let echartsLoader: Promise<typeof import('./echarts-setup')> | null = null;
/** ECharts is fetched once, the first time any chart renders. */
const loadEcharts = () => (echartsLoader ??= import('./echarts-setup'));

/**
 * The only component that talks to ECharts. It lazy-loads the library, renders outside
 * Angular's zone, follows its container's size and feeds option changes into the live
 * instance so values animate to their new positions instead of redrawing.
 */
@Component({
  selector: 'ui-chart-canvas',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ready]': 'ready()' },
  styles: `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      opacity: 0;
      transition: opacity 220ms ease-out;
    }
    :host(.ready) { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      :host { transition: none; }
    }
  `,
})
export class ChartCanvas {
  readonly option = input.required<ChartOption>();
  /** Emits whenever the chart's data window moves (drag, wheel or dispatchZoom). */
  readonly zoomed = output<ChartZoomRange>();

  protected readonly ready = signal(false);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private instance: EChartsType | null = null;

  /** Moves a zoomable chart's data window (e.g. from a custom scrollbar). */
  dispatchZoom(range: ChartZoomRange): void {
    this.zone.runOutsideAngular(() => this.instance?.dispatchAction({ type: 'dataZoom', ...range }));
  }

  constructor() {
    let destroyed = false;
    let resizeObserver: ResizeObserver | undefined;
    let frame = 0;

    let loading = false;
    // Create the chart only once the host is attached and has a size: cards project their chart
    // even while showing a skeleton, and tabs can mount charts hidden.
    const start = () => {
      if (loading || destroyed) return;
      loading = true;
      void loadEcharts().then(({ init }) => {
        if (destroyed) return;
        this.instance = this.zone.runOutsideAngular(() => init(this.host, undefined, { renderer: 'canvas' }));
        this.instance.on('datazoom', () => {
          const zoom = (this.instance?.getOption() as { dataZoom?: Partial<ChartZoomRange>[] })?.dataZoom?.[0];
          if (zoom?.startValue === undefined || zoom.endValue === undefined) return;
          const range = { startValue: Number(zoom.startValue), endValue: Number(zoom.endValue) };
          this.zone.run(() => this.zoomed.emit(range));
        });
        this.ready.set(true);
      });
    };

    afterNextRender(() => {
      this.zone.runOutsideAngular(() => {
        resizeObserver = new ResizeObserver(([entry]) => {
          const { width, height } = entry.contentRect;
          if (!width || !height) return;
          if (!this.instance) {
            this.zone.run(start);
            return;
          }
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => this.instance?.resize());
        });
        resizeObserver.observe(this.host);
      });
    });

    effect(() => {
      const option = this.option();
      if (!this.ready()) return;
      // Series are matched by id and replaced as a set, so removed series disappear while
      // kept ones transition smoothly to their new values.
      untracked(() =>
        this.zone.runOutsideAngular(() => this.instance?.setOption(option, { replaceMerge: ['series', 'dataZoom'] })),
      );
    });

    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      this.instance?.dispose();
      this.instance = null;
    });
  }
}
