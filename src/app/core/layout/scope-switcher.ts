import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../data/store';
import { Icon } from '../../shared/ui/icon';
import { Tooltip } from '@iotility/shared-ui';

/**
 * The tenant scope, under the product name. Platform users (HyperNym) choose "All organizations"
 * or one tenant, and every list follows. Partner users see their own organization, fixed.
 */
@Component({
  selector: 'app-scope-switcher',
  imports: [Icon, Tooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.crossTenant()) {
      <button class="trigger" aria-haspopup="listbox" [tooltip]="store.scopeOrg()?.name ?? 'All organizations'" [position]="'right'" [disabled]="!compact()" [attr.aria-expanded]="open()" (click)="$event.stopPropagation(); open.set(!open())">
        <span class="sw" [style.background]="store.scopeOrg()?.brandColour ?? 'var(--color-brand-400)'"></span>
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
  styleUrl: './scope-switcher.css',
  host: { '[class.compact]': 'compact()' },
})
export class ScopeSwitcher {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef<HTMLElement>);
  /** Icon-only sidebar: just the swatch, the name moves to the tooltip. */
  readonly compact = input(false);
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
