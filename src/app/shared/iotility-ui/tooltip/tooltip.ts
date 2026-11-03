import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

const TOOLTIP_STYLES_ID = 'shared-tooltip-styles';

/*
 * Solid, high-contrast chip (dark ink in light mode, raised surface in dark mode) with a
 * matching arrow. It slides a few pixels out of the trigger while fading in, and leaves
 * faster than it arrives.
 */
const TOOLTIP_STYLES = `
  .shared-tooltip {
    --tooltip-bg: #16181f;
    --tooltip-fg: #f6f7fb;
    --tooltip-ring: rgba(255, 255, 255, 0.06);
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483000;
    max-width: 240px;
    padding: 5px 9px;
    border-radius: 7px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
    letter-spacing: 0.005em;
    text-align: center;
    text-wrap: balance;
    overflow-wrap: anywhere;
    color: var(--tooltip-fg);
    background: var(--tooltip-bg);
    box-shadow:
      inset 0 0 0 1px var(--tooltip-ring),
      0 1px 2px rgba(15, 17, 25, 0.18),
      0 8px 20px -6px rgba(15, 17, 25, 0.35);
    pointer-events: none;
    user-select: none;
    box-sizing: border-box;
    will-change: transform, opacity;
    animation: shared-tooltip-in 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;
  }
  .shared-tooltip-arrow {
    position: absolute;
    width: 10px;
    height: 5px;
    background: var(--tooltip-bg);
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
  .shared-tooltip[data-side='top'] { --tx: 0px; --ty: 4px; transform-origin: var(--arrow-x, 50%) 100%; }
  .shared-tooltip[data-side='bottom'] { --tx: 0px; --ty: -4px; transform-origin: var(--arrow-x, 50%) 0; }
  .shared-tooltip[data-side='left'] { --tx: 4px; --ty: 0px; transform-origin: 100% var(--arrow-y, 50%); }
  .shared-tooltip[data-side='right'] { --tx: -4px; --ty: 0px; transform-origin: 0 var(--arrow-y, 50%); }
  .shared-tooltip[data-side='top'] .shared-tooltip-arrow { top: 100%; left: var(--arrow-x); margin-left: -5px; }
  .shared-tooltip[data-side='bottom'] .shared-tooltip-arrow { bottom: 100%; left: var(--arrow-x); margin-left: -5px; transform: rotate(180deg); }
  .shared-tooltip[data-side='left'] .shared-tooltip-arrow { left: calc(100% - 2.5px); top: var(--arrow-y); margin-top: -2.5px; transform: rotate(-90deg); }
  .shared-tooltip[data-side='right'] .shared-tooltip-arrow { right: calc(100% - 2.5px); top: var(--arrow-y); margin-top: -2.5px; transform: rotate(90deg); }
  /* Moving between neighbouring triggers swaps tooltips instantly instead of re-animating. */
  .shared-tooltip.shared-tooltip-instant { animation: none; }
  .shared-tooltip.shared-tooltip-leaving {
    animation: shared-tooltip-out 100ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  @keyframes shared-tooltip-in {
    from { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.96); }
  }
  @keyframes shared-tooltip-out {
    to { opacity: 0; transform: translate(calc(var(--tx) / 2), calc(var(--ty) / 2)) scale(0.98); }
  }
  @keyframes shared-tooltip-fade-in { from { opacity: 0; } }
  @keyframes shared-tooltip-fade-out { to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .shared-tooltip:not(.shared-tooltip-instant) { animation-name: shared-tooltip-fade-in; }
    .shared-tooltip.shared-tooltip-leaving { animation-name: shared-tooltip-fade-out; }
  }
  :where(.dark) .shared-tooltip {
    --tooltip-bg: #2a2d3a;
    --tooltip-fg: #f4f5f9;
    --tooltip-ring: rgba(255, 255, 255, 0.09);
    box-shadow:
      inset 0 0 0 1px var(--tooltip-ring),
      0 1px 2px rgba(0, 0, 0, 0.35),
      0 10px 24px -6px rgba(0, 0, 0, 0.6);
  }
`;

const SHOW_DELAY_MS = 250;
/** After a tooltip closes, neighbours within this window open instantly, without animation. */
const WARM_WINDOW_MS = 300;
const GAP = 8;
const VIEWPORT_MARGIN = 6;
const ARROW_INSET = 10;
const OPPOSITE: Record<TooltipPosition, TooltipPosition> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

let visibleTooltips = 0;
let lastTooltipHiddenAt = 0;
let nextTooltipId = 0;
const tooltipIsWarm = () => visibleTooltips > 0 || Date.now() - lastTooltipHiddenAt < WARM_WINDOW_MS;

function ensureStyles(document: Document): void {
  if (!document.head || document.getElementById(TOOLTIP_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = TOOLTIP_STYLES_ID;
  style.textContent = TOOLTIP_STYLES;
  document.head.appendChild(style);
}

/** Shared behaviour for the [tooltip] directive and attachTooltip(). */
class TooltipController {
  private readonly document: Document;
  private readonly id = `shared-tooltip-${++nextTooltipId}`;
  private tooltipEl: HTMLElement | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private text = '';
  private side: TooltipPosition = 'top';
  private disabled = false;

  constructor(private readonly host: HTMLElement) {
    this.document = host.ownerDocument;
    host.addEventListener('pointerenter', this.onPointerEnter);
    host.addEventListener('pointerleave', this.onLeave);
    host.addEventListener('focusin', this.onFocusIn);
    host.addEventListener('focusout', this.onLeave);
    host.addEventListener('pointerdown', this.onLeave);
  }

  update(text: string, side: TooltipPosition, disabled: boolean): void {
    this.text = text ?? '';
    this.side = side ?? 'top';
    this.disabled = disabled;
    if (!this.tooltipEl) return;
    if (this.disabled || !this.text) {
      this.hide();
      return;
    }
    this.tooltipEl.querySelector('.shared-tooltip-content')!.textContent = this.text;
    this.position();
  }

  destroy(): void {
    this.host.removeEventListener('pointerenter', this.onPointerEnter);
    this.host.removeEventListener('pointerleave', this.onLeave);
    this.host.removeEventListener('focusin', this.onFocusIn);
    this.host.removeEventListener('focusout', this.onLeave);
    this.host.removeEventListener('pointerdown', this.onLeave);
    this.hide(true);
  }

  // Touch has no hover: a tap would leave the tooltip stuck open.
  private readonly onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') this.scheduleShow();
  };

  // Keyboard focus only; a mouse click focusing the button shouldn't pop a tooltip.
  private readonly onFocusIn = () => {
    if (this.host.matches(':focus-visible') || this.host.querySelector(':focus-visible')) this.scheduleShow();
  };

  private readonly onLeave = () => this.hide();

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.hide();
  };

  // The tooltip is fixed-positioned, so it would drift away from its trigger on scroll.
  private readonly onViewportChange = () => this.hide(true);

  private scheduleShow(): void {
    if (this.disabled || !this.text || this.tooltipEl || this.showTimer !== null) return;
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show();
    }, tooltipIsWarm() ? 0 : SHOW_DELAY_MS);
  }

  private show(): void {
    if (this.disabled || !this.text || this.tooltipEl || !this.host.isConnected) return;
    ensureStyles(this.document);
    const tooltip = this.document.createElement('div');
    tooltip.className = 'shared-tooltip';
    tooltip.id = this.id;
    tooltip.setAttribute('role', 'tooltip');
    if (tooltipIsWarm()) tooltip.classList.add('shared-tooltip-instant');
    const content = this.document.createElement('span');
    content.className = 'shared-tooltip-content';
    content.textContent = this.text;
    const arrow = this.document.createElement('span');
    arrow.className = 'shared-tooltip-arrow';
    tooltip.append(content, arrow);
    this.document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;
    visibleTooltips++;
    this.position();

    const describedBy = this.host.getAttribute('aria-describedby');
    this.host.setAttribute('aria-describedby', describedBy ? `${describedBy} ${this.id}` : this.id);
    this.document.addEventListener('keydown', this.onKeydown);
    this.document.defaultView?.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    this.document.defaultView?.addEventListener('resize', this.onViewportChange);
  }

  /** Picks the preferred side, flips when it doesn't fit, clamps to the viewport and keeps the arrow on the trigger. */
  private position(): void {
    const tooltip = this.tooltipEl;
    if (!tooltip) return;
    const view = this.document.defaultView!;
    const host = this.host.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const room: Record<TooltipPosition, number> = {
      top: host.top,
      bottom: view.innerHeight - host.bottom,
      left: host.left,
      right: view.innerWidth - host.right,
    };
    const needed = (side: TooltipPosition) => (side === 'top' || side === 'bottom' ? height : width) + GAP + VIEWPORT_MARGIN;
    let side = this.side;
    if (room[side] < needed(side) && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

    const vertical = side === 'top' || side === 'bottom';
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
    const left = vertical
      ? clamp(host.left + host.width / 2 - width / 2, VIEWPORT_MARGIN, view.innerWidth - width - VIEWPORT_MARGIN)
      : side === 'left' ? host.left - width - GAP : host.right + GAP;
    const top = vertical
      ? side === 'top' ? host.top - height - GAP : host.bottom + GAP
      : clamp(host.top + host.height / 2 - height / 2, VIEWPORT_MARGIN, view.innerHeight - height - VIEWPORT_MARGIN);

    tooltip.dataset['side'] = side;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    if (vertical) tooltip.style.setProperty('--arrow-x', `${clamp(host.left + host.width / 2 - left, ARROW_INSET, width - ARROW_INSET)}px`);
    else tooltip.style.setProperty('--arrow-y', `${clamp(host.top + host.height / 2 - top, ARROW_INSET, height - ARROW_INSET)}px`);
  }

  private hide(immediate = false): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    const tooltip = this.tooltipEl;
    if (!tooltip) return;
    this.tooltipEl = null;
    visibleTooltips = Math.max(0, visibleTooltips - 1);
    lastTooltipHiddenAt = Date.now();

    const describedBy = (this.host.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== this.id).join(' ');
    if (describedBy) this.host.setAttribute('aria-describedby', describedBy);
    else this.host.removeAttribute('aria-describedby');
    this.document.removeEventListener('keydown', this.onKeydown);
    this.document.defaultView?.removeEventListener('scroll', this.onViewportChange, { capture: true });
    this.document.defaultView?.removeEventListener('resize', this.onViewportChange);

    if (immediate) {
      tooltip.remove();
      return;
    }
    tooltip.classList.remove('shared-tooltip-instant');
    tooltip.classList.add('shared-tooltip-leaving');
    tooltip.addEventListener('animationend', () => tooltip.remove(), { once: true });
    setTimeout(() => tooltip.remove(), 160);
  }
}

/** Imperative tooltip for elements created outside Angular templates (e.g. map controls). Returns a cleanup function. */
export function attachTooltip(host: HTMLElement, text: string, position: TooltipPosition = 'top'): () => void {
  const controller = new TooltipController(host);
  controller.update(text, position, false);
  return () => controller.destroy();
}

@Directive({
  selector: '[tooltip]',
  standalone: true,
})
export class Tooltip implements OnDestroy {
  readonly tooltip = input<string>('');
  readonly position = input<TooltipPosition>('top');
  readonly disabled = input(false);

  private readonly controller = new TooltipController(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);

  constructor() {
    effect(() => this.controller.update(this.tooltip(), this.position(), this.disabled()));
  }

  ngOnDestroy(): void {
    this.controller.destroy();
  }
}
