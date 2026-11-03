import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../data/store';
import { Icon, IconName } from '../../shared/ui/icon';
import { NAV, NAV_FOOTER } from './nav';

interface Hit {
  kind: string;
  label: string;
  sub: string;
  icon: IconName;
  go: string[];
}

/**
 * Jump to a customer, a device ID or a screen. Opened by ⌘K / Ctrl K dozens of times a day,
 * so it appears instantly with no animation (Emil: never animate keyboard-initiated actions).
 */
@Component({
  selector: 'app-global-search',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" [class.open]="open() && q().length > 0">
      <app-icon name="search" class="lead" />
      <input
        #input
        class="ui-control"
        type="search"
        placeholder="Search customers, device IDs, screens"
        aria-label="Search"
        [value]="q()"
        (input)="q.set(input.value); active.set(0); open.set(true)"
        (focus)="open.set(true)"
        (keydown.arrowdown)="move(1, $event)"
        (keydown.arrowup)="move(-1, $event)"
        (keydown.enter)="choose(hits()[active()])"
      />
      <kbd>Ctrl K</kbd>
      @if (open() && q().length > 0) {
        <ul class="results" role="listbox">
          @for (h of hits(); track h.kind + h.label; let i = $index) {
            <li role="option" [attr.aria-selected]="i === active()" [class.active]="i === active()"
                (mousedown)="$event.preventDefault(); choose(h)" (mouseenter)="active.set(i)">
              <app-icon [name]="h.icon" />
              <span class="lbl">{{ h.label }}</span>
              <span class="sub">{{ h.sub }}</span>
            </li>
          } @empty {
            <li class="none">No customer, device or screen matches “{{ q() }}”.</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .box { position: relative; width: min(520px, 100%); display: flex; align-items: center; }
    .lead { position: absolute; left: 10px; color: var(--muted); pointer-events: none; }
    .ui-control { padding-left: 32px; padding-right: 64px; background: var(--surface); height: 34px; }
    .ui-control::-webkit-search-cancel-button { display: none; }
    kbd {
      position: absolute; right: 8px; font: 500 11px var(--font); color: var(--muted);
      border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; background: var(--raised);
    }
    .results {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 70; margin: 0; padding: 4px; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-float);
      max-height: 360px; overflow: auto;
    }
    li { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border-radius: 4px; cursor: pointer; color: var(--muted); }
    li.active { background: var(--raised); color: var(--text); }
    .lbl { color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { margin-left: auto; font-size: 12px; white-space: nowrap; }
    .none { cursor: default; height: auto; padding: 10px; }
  `,
})
export class GlobalSearch {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  protected readonly q = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);

  private readonly screens: Hit[] = [...NAV.flatMap((g) => g.items), ...NAV_FOOTER].map((i) => ({
    kind: 'screen', label: i.label, sub: 'Screen', icon: i.icon, go: [i.path],
  }));

  protected readonly hits = computed<Hit[]>(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return [];
    const customers = this.store
      .customers()
      .filter((c) => c.company.toLowerCase().includes(q) || c.email.includes(q))
      .slice(0, 5)
      .map<Hit>((c) => ({ kind: 'customer', label: c.company, sub: `Customer · ${c.package}`, icon: 'building-2', go: ['/customers', String(c.id)] }));
    const devices = this.store
      .devices()
      .filter((d) => d.id.toLowerCase().includes(q) || d.imei.includes(q) || (d.plate ?? '').toLowerCase().includes(q))
      .slice(0, 4)
      .map<Hit>((d) => ({ kind: 'device', label: d.id, sub: `Device · ${d.status}`, icon: 'cpu', go: ['/devices', d.id] }));
    const screens = this.screens.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 4);
    return [...screens, ...customers, ...devices];
  });

  @HostListener('document:keydown', ['$event'])
  protected shortcut(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.input().nativeElement.focus();
      this.input().nativeElement.select();
    }
    if (e.key === 'Escape') {
      this.open.set(false);
      this.input().nativeElement.blur();
    }
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent) {
    if (!this.el.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  protected move(d: number, e: Event) {
    e.preventDefault();
    const n = this.hits().length;
    if (n) this.active.set((this.active() + d + n) % n);
  }

  protected choose(h: Hit | undefined) {
    if (!h) return;
    this.router.navigate(h.go);
    this.q.set('');
    this.open.set(false);
    this.input().nativeElement.blur();
  }
}
