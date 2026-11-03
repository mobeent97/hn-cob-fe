import { Directive, ElementRef, NgZone, OnDestroy, afterNextRender, inject } from '@angular/core';

/**
 * Cursor-tracked border glow: on hover, a gradient centred on the pointer lights up the edge of the
 * host nearest the cursor. Colour comes from `--spotlight-color` (defaults to brand). Styles live in
 * shared-ui theme.css (.has-spotlight). The host should be a positioned card with a border radius.
 */
@Directive({
  selector: '[sharedSpotlightBorder]',
  host: { class: 'has-spotlight' },
})
export class SpotlightBorder implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private frame = 0;
  private detach?: () => void;

  constructor() {
    afterNextRender(() => {
      // Only for real hover pointers; touch has no cursor to follow.
      if (!globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
      // Outside Angular: pointer moves must not trigger change detection.
      this.zone.runOutsideAngular(() => {
        const move = (event: PointerEvent) => {
          cancelAnimationFrame(this.frame);
          this.frame = requestAnimationFrame(() => {
            const rect = this.host.getBoundingClientRect();
            // Set on the host itself (not a parent) so only its own pseudo-element restyles.
            this.host.style.setProperty('--spotlight-x', `${event.clientX - rect.left}px`);
            this.host.style.setProperty('--spotlight-y', `${event.clientY - rect.top}px`);
          });
        };
        this.host.addEventListener('pointermove', move, { passive: true });
        this.detach = () => this.host.removeEventListener('pointermove', move);
      });
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.detach?.();
  }
}
