import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../data/store';
import { Icon } from '../../shared/ui/icon';

/**
 * The tenant scope, under the product name. Platform users (HyperNym) choose "All organizations"
 * or one tenant, and every list follows. Partner users see their own organization, fixed.
 */
@Component({
  selector: 'app-scope-switcher',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.crossTenant()) {
      <button class="trigger" aria-haspopup="listbox" [attr.aria-expanded]="open()" (click)="$event.stopPropagation(); open.set(!open())">
        <span class="sw" [style.background]="store.scopeOrg()?.brandColour ?? 'var(--chart-3)'"></span>
        <span class="text">
          <strong>{{ store.scopeOrg()?.name ?? 'All organizations' }}</strong>
          <small>{{ store.scopeOrg() ? store.scopeOrg()!.kind : orgs().length + ' organizations' }}</small>
        </span>
        <app-icon name="chevrons-up-down" [size]="14" />
      </button>
      @if (open()) {
        <ul class="pop" role="listbox" aria-label="Organization">
          <li>
            <button role="option" [attr.aria-selected]="store.activeOrgId() === null" (click)="choose(null)">
              <span class="sw all"></span>
              <span class="text"><strong>All organizations</strong><small>Every tenant's customers and devices</small></span>
              @if (store.activeOrgId() === null) { <app-icon name="check" [size]="14" /> }
            </button>
          </li>
          @for (o of orgs(); track o.id) {
            <li>
              <button role="option" [attr.aria-selected]="store.activeOrgId() === o.id" (click)="choose(o.id)">
                <span class="sw" [style.background]="o.brandColour"></span>
                <span class="text">
                  <strong>{{ o.name }}</strong>
                  <small>{{ o.kind }} · {{ o.countries.join(', ') }}{{ o.status !== 'Active' ? ' · ' + o.status : '' }}</small>
                </span>
                @if (store.activeOrgId() === o.id) { <app-icon name="check" [size]="14" /> }
              </button>
            </li>
          }
        </ul>
      }
    } @else {
      <div class="trigger static" [title]="store.currentOrg().legalName">
        <span class="sw" [style.background]="store.currentOrg().brandColour"></span>
        <span class="text"><strong>{{ store.currentOrg().name }}</strong><small>Partner organization</small></span>
      </div>
    }
  `,
  styles: `
    :host { display: block; position: relative; margin: 0 0 6px; }
    .trigger {
      width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; padding: 7px 10px;
      border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text);
      transition: border-color var(--duration-quick) ease;
    }
    button.trigger:hover { border-color: var(--control); }
    .trigger app-icon { color: var(--muted); margin-left: auto; }
    .text { display: flex; flex-direction: column; min-width: 0; line-height: 16px; }
    .text strong { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .text small { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .sw.all { background: conic-gradient(var(--chart-1) 0 50%, var(--chart-3) 0); }
    .pop {
      position: absolute; top: calc(100% + 4px); left: 0; right: -60px; z-index: 70; margin: 0; padding: 4px; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-float);
      transform-origin: top left;
      transition: opacity var(--duration-quick) var(--ease-out), transform var(--duration-fast) var(--ease-out);
      @starting-style { opacity: 0; transform: scale(var(--scale-menu)); }
    }
    .pop button {
      width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; border: 0; background: none;
      padding: 8px 10px; border-radius: 4px; color: var(--text);
    }
    .pop button:hover { background: var(--raised); }
    .pop app-icon { margin-left: auto; color: var(--text); }
  `,
})
export class ScopeSwitcher {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);
  protected readonly orgs = computed(() => this.store.organizations());

  protected choose(id: number | null) {
    this.store.activeOrgId.set(id);
    this.open.set(false);
    // Detail pages may belong to another tenant now; lists simply re-filter.
    if (/\/(customers|devices)\/[^/]+/.test(this.router.url)) this.router.navigate([this.router.url.split('/')[1]]);
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent) {
    if (!this.el.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
  @HostListener('document:keydown.escape')
  protected esc() {
    this.open.set(false);
  }
}
