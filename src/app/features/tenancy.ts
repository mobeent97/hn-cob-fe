import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { Store } from '../core/data/store';
import { Access } from '../core/access/access';
import { Organization } from '../core/data/models';
import { Icon } from '../shared/ui/icon';
import { Select, SelectOption } from '../shared/ui/select';

/**
 * Tenant context for list screens. `showOrg` is true only when a platform user looks at
 * All organizations: that is when rows need an Organization column, filter and CSV field.
 * Call in an injection context (field initialiser).
 */
export function orgContext() {
  const store = inject(Store);
  const byId = computed(() => new Map(store.organizations().map((o) => [o.id, o])));
  return {
    showOrg: computed(() => store.crossTenant() && store.scopeOrgId() == null),
    orgs: store.organizations,
    org: (id: number | null | undefined): Organization | null => (id == null ? null : byId().get(id) ?? null),
    name: (id: number | null | undefined) => (id == null ? 'Shared' : byId().get(id)?.name ?? '—'),
  };
}

/** Organization name with its brand swatch. */
@Component({
  selector: 'app-org-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'org-tag' },
  template: `<span class="sw" [style.background]="org()?.brandColour ?? 'var(--color-muted)'"></span><span class="nm">{{ org()?.name ?? (id() == null ? 'Shared' : '—') }}</span>`,
  // Inline styles can't @reference Tailwind, so these use the IoTility theme variables directly.
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 0;
      white-space: nowrap;
    }
    .sw {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
    }
    .nm {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class OrgTag {
  private readonly ctx = orgContext();
  readonly id = input<number | null | undefined>(null);
  protected readonly org = computed(() => this.ctx.org(this.id()));
}

/** Toolbar select: All organizations or one. Value null = all. */
@Component({
  selector: 'app-org-filter',
  imports: [Select, SelectOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="sr-only" [attr.for]="fid">Organization</label>
    <app-select [id]="fid" [value]="value() ?? ''" (valueChange)="pick($event)">
      <app-option value="">All organizations</app-option>
      @for (o of orgs(); track o.id) {
        <app-option [value]="o.id" [selected]="value() === o.id">{{ o.name }}</app-option>
      }
    </app-select>
  `,
})
export class OrgFilter {
  private static seq = 0;
  protected readonly fid = `org-filter-${++OrgFilter.seq}`;
  protected readonly orgs = inject(Store).organizations;
  readonly value = model<number | null>(null);
  protected pick(v: string) {
    this.value.set(v ? +v : null);
  }
}

/**
 * The quiet line under a title on a read-only screen:
 * "You can view customers. Ask an administrator in Vodafone Qatar for edit access."
 */
@Component({
  selector: 'app-ro-note',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-icon name="lock" [size]="13" />You can view {{ noun() }}. {{ ask() }}`,
  host: { class: 'ro-note', role: 'note' },
  // Same as text-xs text-muted dark:text-brand-300, written with the theme variables (inline styles can't @apply).
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--color-muted);
      font-size: 0.75rem;
      line-height: 1rem;
    }
    :host-context(.dark) {
      color: var(--color-brand-300);
    }
  `,
})
export class ReadOnlyNote {
  private readonly store = inject(Store);
  readonly noun = input.required<string>();
  protected readonly ask = computed(() => {
    const org = this.store.currentOrg();
    return `Ask an administrator in ${org.name} for edit access.`;
  });
}

/** Write access for one feature, as signals: `rw()` and `ro()` (read-only but visible). */
export function writeAccess(feature: string) {
  const access = inject(Access);
  return {
    rw: computed(() => access.can(feature, 'RW')),
    ro: computed(() => !access.can(feature, 'RW')),
  };
}
