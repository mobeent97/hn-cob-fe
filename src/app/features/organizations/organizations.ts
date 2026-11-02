import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { DatePipe } from '../../core/data/format';
import { Organization } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { featureCount, orgTone } from './org-util';
import { OrgDetail } from './org-detail';
import { OrgWizard } from './org-wizard';
import { OrgStats, orgStats } from './org-stats';
import { ReadOnlyNote } from '../tenancy';

/**
 * Organizations — "Which partners run on the portal, and what can each of them do?"
 * Platform screen: counts span every tenant (`.all()`). `?org=<id>` opens one organization in place.
 */
@Component({
  selector: 'app-organizations',
  imports: [Icon, Menu, Dialog, DatePipe, OrgDetail, OrgWizard, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organizations.html',
  styleUrl: './organizations.scss',
})
export class Organizations {
  protected readonly store = inject(Store);
  private readonly access = inject(Access);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('organizations');

  readonly orgParam = input<string | undefined>(undefined, { alias: 'org' });
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });
  protected readonly openId = computed(() => {
    const v = Number(this.orgParam());
    return Number.isFinite(v) && v > 0 ? v : null;
  });

  protected readonly canWrite = computed(() => this.access.can('Organizations', 'RW'));
  protected readonly wizardOpen = signal(false);
  protected readonly orgTone = orgTone;

  protected readonly stats = computed(() => orgStats(this.store));

  /** Platform first, then partners by name. */
  protected readonly rows = computed(() => {
    const s = this.stats();
    return [...this.store.organizations()]
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'Platform' ? -1 : 1))
      .map((o) => ({ ...o, s: s.get(o.id)!, f: featureCount(o) }));
  });

  /** "3 partners · 1 invitation pending · Vodafone Qatar at 12 of 50 customers" */
  protected readonly subline = computed(() => {
    const partners = this.rows().filter((r) => r.kind === 'Partner');
    const parts = [`${partners.length} ${partners.length === 1 ? 'partner' : 'partners'}`];
    const invited = partners.filter((r) => r.status === 'Invited').length;
    if (invited) parts.push(`${invited} ${invited === 1 ? 'invitation' : 'invitations'} pending`);
    const suspended = partners.filter((r) => r.status === 'Suspended').length;
    if (suspended) parts.push(`${suspended} suspended`);
    const closest = partners
      .filter((r) => r.limits.maxCustomers && r.s.customers > 0)
      .sort((a, b) => b.s.customers / b.limits.maxCustomers! - a.s.customers / a.limits.maxCustomers!)[0];
    if (closest) parts.push(`${closest.name} at ${closest.s.customers} of ${closest.limits.maxCustomers} customers`);
    return parts.join(' · ');
  });

  protected countryLabel(o: Organization) {
    const first = this.store.countries.find((c) => c.code === o.countries[0])?.name ?? o.countries[0];
    return o.countries.length > 1 ? `${first} +${o.countries.length - 1}` : first ?? '—';
  }
  protected countryTitle(o: Organization) {
    return o.countries.map((c) => this.store.countries.find((x) => x.code === c)?.name ?? c).join(', ');
  }
  protected pct(n: number, max: number | null) {
    return max ? Math.min(100, (n / max) * 100) : 0;
  }

  open(id: number) {
    this.router.navigate([], { queryParams: { org: id, tab: null }, queryParamsHandling: 'merge' });
  }
  protected close() {
    this.router.navigate([], { queryParams: { org: null, tab: null }, queryParamsHandling: 'merge' });
  }

  // ── Row actions (shared with the detail through OrgActions) ──
  protected readonly confirm = signal<{ kind: 'suspend' | 'reactivate'; org: Organization } | null>(null);
  protected readonly confirmOpen = signal(false);

  protected menu(o: Organization & { s: OrgStats }): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Open', icon: 'eye', run: () => this.open(o.id) },
      { label: 'View as this organization', icon: 'building-2', run: () => this.viewAs(o) },
    ];
    if (!this.canWrite() || o.kind === 'Platform') return items;
    if (o.status === 'Invited') items.push({ label: 'Resend invitation', icon: 'send', run: () => this.resend(o) });
    items.push(
      o.status === 'Suspended'
        ? { label: 'Reactivate', icon: 'play', run: () => this.ask('reactivate', o) }
        : { label: 'Suspend', icon: 'pause', danger: true, run: () => this.ask('suspend', o) },
    );
    return items;
  }

  viewAs(o: Organization) {
    this.store.activeOrgId.set(o.id);
    this.router.navigate(['/dashboard']);
  }

  resend(o: Organization) {
    const admin = this.store.allUsers().find((u) => u.orgId === o.id && u.groups.includes('Organization admin'));
    const to = admin?.email ?? o.contact.email;
    this.toast.show('Invitation sent again', { body: `${to} has a new sign-in link, valid for 7 days.` });
  }

  ask(kind: 'suspend' | 'reactivate', org: Organization) {
    this.confirm.set({ kind, org });
    this.confirmOpen.set(true);
  }

  protected readonly confirmCopy = computed(() => {
    const c = this.confirm();
    if (!c) return { title: '', body: '', action: '' };
    const s = this.stats().get(c.org.id);
    const users = s?.users ?? 0;
    if (c.kind === 'suspend') {
      return {
        title: `Suspend ${c.org.name}?`,
        body: `Its ${users} ${users === 1 ? 'user' : 'users'} can't sign in while it is suspended. Their ${s?.customers ?? 0} customers and ${s?.inService ?? 0} devices in service keep running, and nothing is deleted. You can reactivate it at any time.`,
        action: 'Suspend organization',
      };
    }
    return { title: `Reactivate ${c.org.name}?`, body: `Its ${users} ${users === 1 ? 'user' : 'users'} can sign in again straight away.`, action: 'Reactivate' };
  });

  protected runConfirm() {
    const c = this.confirm();
    if (!c) return;
    const before = c.org.status;
    const org = this.store.organizations().find((o) => o.id === c.org.id)!;
    if (c.kind === 'suspend') {
      this.store.saveOrganization({ ...org, status: 'Suspended' });
      this.toast.show(`${org.name} suspended`, {
        body: 'Its users are signed out and can’t sign in.',
        action: { label: 'Undo', run: () => this.store.saveOrganization({ ...org, status: before }) },
      });
    } else {
      this.store.saveOrganization({ ...org, status: 'Active' });
      this.toast.show(`${org.name} reactivated`);
    }
    this.confirmOpen.set(false);
  }

  protected created(o: Organization) {
    this.open(o.id);
  }
}
