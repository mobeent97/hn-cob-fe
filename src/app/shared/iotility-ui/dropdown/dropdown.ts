import {
  AnimationCallbackEvent,
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
export type DropdownMode = 'action' | 'navigation' | 'single' | 'multi';
export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
  route?: string;
  icon?: 'user' | 'logout' | 'settings' | 'check' | 'location' | 'view' | 'edit' | 'delete' | 'excel' | 'pdf';
  disabled?: boolean;
}
/** Open-state clip (matches .dropdown-panel in dropdown.css): reaches past the box so the shadow isn't cut. */
const OPEN_CLIP = 'inset(-16px -16px -40px -16px round 12px)';
@Component({
  selector: 'shared-dropdown',
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.css',
})
export class Dropdown implements AfterViewInit {
  readonly options = input.required<DropdownOption[]>();
  readonly mode = input<DropdownMode>('action');
  readonly searchable = input(false);
  readonly searchPlaceholder = input('Search options');
  readonly align = input<'left' | 'right'>('right');
  readonly density = input<'default' | 'compact'>('default');
  readonly showOptionIcons = input(true);
  readonly showSelectionMarks = input(true);
  readonly matchTriggerWidth = input(false);
  readonly placement = input<'bottom' | 'top'>('bottom');
  readonly selected = input<string[]>([]);
  readonly optionSelected = output<DropdownOption>();
  readonly selectionChange = output<string[]>();
  protected readonly isOpen = signal(false);
  protected readonly query = signal('');
  protected readonly localSelected = signal<string[]>([]);
  protected readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q
      ? this.options().filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q))
      : this.options();
  });
  constructor(
    private readonly element: ElementRef<HTMLElement>,
    private readonly router: Router,
  ) {}
  ngAfterViewInit(): void {
    // Select modes use the generic field look (controls.css), so every select matches inputs everywhere.
    if (this.mode() !== 'single' && this.mode() !== 'multi') return;
    const trigger = this.element.nativeElement.querySelector<HTMLElement>('[dropdown-trigger]');
    trigger?.classList.add('ui-control', 'ui-select');
    if (this.density() === 'compact') trigger?.classList.add('ui-control-sm');
  }
  protected toggle(): void {
    this.isOpen.update((v) => !v);
    if (this.isOpen()) this.localSelected.set([...this.selected()]);
  }
  protected choose(option: DropdownOption): void {
    if (option.disabled) return;
    if (this.mode() === 'multi') {
      const next = this.isSelected(option.id)
        ? this.localSelected().filter((id) => id !== option.id)
        : [...this.localSelected(), option.id];
      this.localSelected.set(next);
      this.selectionChange.emit(next);
      return;
    }
    if (this.mode() === 'single') {
      this.localSelected.set([option.id]);
      this.selectionChange.emit([option.id]);
    }
    if (this.mode() === 'navigation' && option.route) void this.router.navigateByUrl(option.route);
    this.optionSelected.emit(option);
    this.close();
  }
  protected isSelected(id: string): boolean {
    return this.localSelected().includes(id) || (!this.isOpen() && this.selected().includes(id));
  }
  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
  protected close(): void {
    this.isOpen.set(false);
    this.query.set('');
  }
  /** Morph open: the panel starts as the trigger (same box and corner radius) and springs out into the menu. */
  protected morphIn(event: AnimationCallbackEvent): void {
    const panel = event.target as HTMLElement;
    panel.style.opacity = '0'; // hidden for the one frame until it is measured
    requestAnimationFrame(() => {
      panel.style.opacity = '';
      const from = this.reduceMotion() ? null : this.triggerFrame(panel);
      const animation = from
        ? panel.animate(
            [
              { transform: from.transform, clipPath: from.clipPath, opacity: 0.85 },
              { transform: 'none', clipPath: OPEN_CLIP, opacity: 1 },
            ],
            { duration: 340, easing: this.springEasing() },
          )
        : panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
      void animation.finished.finally(() => event.animationComplete());
    });
  }

  /** Morph closed: content fades first, then the panel folds back into the trigger. Snappier than opening. */
  protected morphOut(event: AnimationCallbackEvent): void {
    const panel = event.target as HTMLElement;
    panel.style.pointerEvents = 'none';
    const to = this.reduceMotion() ? null : this.triggerFrame(panel);
    for (const child of Array.from(panel.children)) {
      child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
    }
    const animation = to
      ? panel.animate(
          [
            { transform: 'none', clipPath: OPEN_CLIP, opacity: 1 },
            { transform: to.transform, clipPath: to.clipPath, opacity: 0 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
        )
      : panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    void animation.finished.finally(() => event.animationComplete());
  }

  /** Sliding hover highlight: one pill glides to whichever option the pointer is over. */
  protected highlight(event: PointerEvent): void {
    const list = event.currentTarget as HTMLElement;
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>('.dropdown-option');
    const pill = list.querySelector<HTMLElement>('.option-highlight');
    if (!option || !pill || option.disabled) return;
    const firstShow = !pill.classList.contains('ready') || pill.style.opacity !== '1';
    if (firstShow) pill.classList.remove('ready'); // appear in place, don't slide in from the last spot
    pill.style.transform = `translateY(${option.offsetTop}px)`;
    pill.style.height = `${option.offsetHeight}px`;
    if (firstShow) {
      void pill.offsetWidth;
      pill.classList.add('ready');
    }
    pill.style.opacity = '1';
  }

  protected clearHighlight(event: PointerEvent): void {
    const pill = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.option-highlight');
    if (pill) pill.style.opacity = '0';
  }

  /** Where the panel must start so it sits exactly on the trigger, and the clip that cuts it to the trigger's shape. */
  private triggerFrame(panel: HTMLElement): { transform: string; clipPath: string } | null {
    const trigger = this.element.nativeElement.querySelector<HTMLElement>('[dropdown-trigger]');
    if (!trigger) return null;
    const t = trigger.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    if (!t.width || !p.width) return null;
    const alignLeft = panel.classList.contains('left') || panel.classList.contains('match-trigger');
    const above = panel.classList.contains('above');
    const dx = alignLeft ? t.left - p.left : t.right - p.right;
    const dy = above ? t.bottom - p.bottom : t.top - p.top;
    const top = Math.max(t.top - (p.top + dy), 0);
    const left = Math.max(t.left - (p.left + dx), 0);
    const right = Math.max(p.right + dx - t.right, 0);
    const bottom = Math.max(p.bottom + dy - t.bottom, 0);
    const radius = getComputedStyle(trigger).borderRadius || '12px';
    return {
      transform: `translate(${dx}px, ${dy}px)`,
      clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius})`,
    };
  }

  private springEasing(): string {
    const spring = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim();
    return spring || 'cubic-bezier(0.23, 1, 0.32, 1)';
  }

  private reduceMotion(): boolean {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  @HostListener('document:click', ['$event']) protected outside(event: Event): void {
    if (!this.element.nativeElement.contains(event.target as Node)) this.close();
  }
  @HostListener('document:keydown.escape') protected escape(): void {
    this.close();
  }
}
