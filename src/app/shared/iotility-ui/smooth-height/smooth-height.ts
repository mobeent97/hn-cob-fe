import { AfterViewInit, Component, ElementRef, OnDestroy, input, signal, viewChild } from '@angular/core';

@Component({
  selector: 'shared-smooth-height',
  templateUrl: './smooth-height.html',
  styleUrl: './smooth-height.css',
})
export class SmoothHeight implements AfterViewInit, OnDestroy {
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');
  /** Stop clipping the frame once a size settles, so overlays in the content (dropdown panels) stay visible. */
  readonly unclip = input(false);
  protected readonly height = signal<number | null>(null);
  protected readonly ready = signal(false);
  /** True only while the frame is tweening, so overflow clipping never hides overlays (dropdown panels) once the size settles. */
  protected readonly animating = signal(false);
  private observer?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private frameElement?: HTMLElement;

  constructor(private readonly element: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    const content = this.content().nativeElement;
    this.frameElement = this.frame().nativeElement;
    this.height.set(content.getBoundingClientRect().height);
    this.observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (Math.abs(next - (this.height() ?? 0)) > 0.5) this.startAnimating();
      this.height.set(next);
    });
    this.observer.observe(content);
    this.frameElement.addEventListener('transitionend', this.settled);
    requestAnimationFrame(() => this.ready.set(true));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    clearTimeout(this.timer);
    this.frameElement?.removeEventListener('transitionend', this.settled);
  }

  private startAnimating(): void {
    this.animating.set(true);
    clearTimeout(this.timer);
    // Fallback for when no height transition runs (first paint, reduced motion).
    this.timer = setTimeout(() => this.animating.set(false), this.durationMs() + 80);
  }

  private readonly settled = (event: TransitionEvent): void => {
    if (event.propertyName === 'height') this.animating.set(false);
  };

  private durationMs(): number {
    const value = parseFloat(
      getComputedStyle(this.element.nativeElement).getPropertyValue('--smooth-height-duration'),
    );
    return Number.isFinite(value) ? value : 260;
  }
}
