import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject, input } from '@angular/core';

/**
 * One indicator that slides between items instead of each item drawing (and teleporting) its own.
 * Put it on a tab bar or nav; it follows whichever descendant has the active class
 * (routerLinkActive / [class.active]).
 * - `underline` (default): a 2px bar under the active tab.
 * - `pill`: a filled background behind the active item (sidebars, segmented controls).
 * Styles live in shared-ui theme.css (.shared-tab-indicator).
 */
@Directive({
  selector: '[sharedTabIndicator]',
  host: {
    class: 'has-tab-indicator',
    '[class.tab-indicator-pill-host]': "tabIndicatorVariant() === 'pill'",
  },
})
export class TabIndicator implements AfterViewInit, OnDestroy {
  /** Horizontal inset (px) from each side of the active item (underline only). */
  readonly tabIndicatorInset = input(0);
  /** Class that marks the active item. */
  readonly tabIndicatorActiveClass = input('active');
  readonly tabIndicatorVariant = input<'underline' | 'pill'>('underline');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private indicator?: HTMLSpanElement;
  private mutations?: MutationObserver;
  private resizes?: ResizeObserver;
  private observedActive?: HTMLElement;
  private frame = 0;
  private pendingSlide = false;
  private visible = false;
  /** Last geometry written, so no-op updates never interrupt a slide in progress. */
  private applied = '';

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.zone.runOutsideAngular(() => this.attach());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.mutations?.disconnect();
    this.resizes?.disconnect();
    this.indicator?.remove();
  }

  private attach(): void {
    this.indicator = document.createElement('span');
    this.indicator.className = `shared-tab-indicator ${this.tabIndicatorVariant()}`;
    this.indicator.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.indicator);

    // A selection change slides; anything else (resize, sidebar collapse, content reflow) snaps.
    this.mutations = new MutationObserver(() => this.schedule(true));
    this.mutations.observe(this.host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    this.resizes = new ResizeObserver(() => this.schedule(false));
    this.resizes.observe(this.host);

    this.update(false);
    // First placement snaps; only later changes slide.
    requestAnimationFrame(() => this.indicator?.classList.add('ready'));
  }

  private schedule(animate: boolean): void {
    // A selection change in the same frame as a resize still slides.
    this.pendingSlide ||= animate;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const slide = this.pendingSlide;
      this.pendingSlide = false;
      this.update(slide);
    });
  }

  private update(animate: boolean): void {
    const indicator = this.indicator;
    if (!indicator) return;
    const active = this.host.querySelector<HTMLElement>(`.${this.tabIndicatorActiveClass()}`);
    if (!active || active.offsetWidth === 0) {
      indicator.style.opacity = '0';
      this.visible = false;
      return;
    }
    if (active !== this.observedActive) {
      if (this.observedActive) this.resizes?.unobserve(this.observedActive);
      this.resizes?.observe(active);
      this.observedActive = active;
    }

    const hostRect = this.host.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    const left = rect.left - hostRect.left - this.host.clientLeft + this.host.scrollLeft;
    const top = rect.top - hostRect.top - this.host.clientTop + this.host.scrollTop;

    let width = '';
    let height = '';
    let transform: string;
    if (this.tabIndicatorVariant() === 'pill') {
      width = `${rect.width}px`;
      height = `${rect.height}px`;
      transform = `translate(${left}px, ${top}px)`;
    } else {
      const inset = this.tabIndicatorInset();
      transform = `translateX(${left + inset}px) scaleX(${Math.max(rect.width - inset * 2, 0)})`;
    }

    // Nothing moved (e.g. ResizeObserver's initial callback for the newly observed item):
    // leave the indicator alone, otherwise the snap below would cancel the slide mid-flight.
    const geometry = `${transform}|${width}|${height}`;
    if (this.visible && geometry === this.applied) return;
    this.applied = geometry;

    // Coming back from hidden: appear in place rather than sliding in from the old spot.
    const slide = animate && this.visible;
    if (!slide) indicator.style.transition = 'none';

    indicator.style.width = width;
    indicator.style.height = height;
    indicator.style.transform = transform;
    indicator.style.opacity = '1';
    this.visible = true;

    if (!slide) {
      void indicator.offsetWidth; // commit the snapped position before restoring transitions
      indicator.style.transition = '';
    }
  }
}
