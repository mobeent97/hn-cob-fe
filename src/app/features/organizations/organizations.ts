import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { DatePipe } from '../../core/data/format';
import { Organization } from '../../core/data/models';
import { OrganizationsApi } from '../../core/api/organizations.api';
import { AuditApi } from '../../core/api/audit.api';
import { errorText } from '../../core/api/api-client';
import { SessionLoader } from '../../core/auth/session-loader';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { OrgLogo } from '../../shared/ui/org-logo';
import { featureCount, orgTone } from './org-util';
import { OrgDetail } from './org-detail';
import { OrgWizard } from './org-wizard';
import { OrgStats, statsOf } from './org-stats';
import { ReadOnlyNote } from '../tenancy';

type Row = Organization & { s: OrgStats; f: { on: number; of: number } };

/**
 * Organizations — "Which partners run on the portal, and what can each of them do?"
 * Platform screen (GET /organizations/?limit=100; the subline from `summary`). `?org=<id>` opens one
 * organization in place. Suspend and reactivate, resend the invitation, and delete (through the
 * deletion audit) from the row menu.
 */
@Component({
  selector: 'app-organizations',
  imports: [Icon, Menu, Dialog, DatePipe, OrgDetail, OrgWizard, ReadOnlyNote, LoadError, OrgLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organizations.html',
  styleUrls: ['./org-shared.css', './organizations.css'],
})
export class Organizations {
  protected readonly store = inject(Store);
  private readonly access = inject(Access);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  private readonly api = inject(OrganizationsApi);
  private readonly audit = inject(AuditApi);
  private readonly session = inject(SessionLoader);
  protected readonly state = loadState();

  readonly orgParam = input<string | undefined>(undefined, { alias: 'org' });
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });
  protected readonly openId = computed(() => {
    const v = Number(this.orgParam());
    return Number.isFinite(v) && v > 0 ? v : null;
  });

  protected readonly canWrite = computed(() => this.access.can('Organizations', 'RW'));
  protected readonly wizardOpen = signal(false);
  protected readonly orgTone = orgTone;
  protected readonly list = signal<Organization[]>([]);
  protected readonly summary = signal<{ partners: number; invited: number; suspended: number } | null>(null);

  constructor() {
    void this.load();
  }

  protected async load() {
    const res = await this.state.run(() => this.api.list({ limit: 100 }));
    if (!res) return;
    this.list.set(res.rows);
    this.summary.set(res.summary);
    // The full objects also feed the switcher, pickers and the Roles caps.
    this.store.mergeOrganizations(res.rows);
  }

  /** The server orders Platform first, then partners by name. */
  protected readonly rows = computed<Row[]>(() => this.list().map((o) => ({ ...o, s: statsOf(o), f: featureCount(o) })));

  /** "3 partners · 1 invitation pending · Vodafone Qatar at 12 of 50 customers" */
  protected readonly subline = computed(() => {
    const sum = this.summary();
    const partners = this.rows().filter((r) => r.kind === 'Partner');
    const n = sum?.partners ?? partners.length;
    const parts = [`${n} ${n === 1 ? 'partner' : 'partners'}`];
    const invited = sum?.invited ?? 0;
    if (invited) parts.push(`${invited} ${invited === 1 ? 'invitation' : 'invitations'} pending`);
    const suspended = sum?.suspended ?? 0;
    if (suspended) parts.push(`${suspended} suspended`);
    const closest = partners
      .filter((r) => r.limits.maxCustomers && r.s.customers > 0)
      .sort((a, b) => b.s.customers / b.limits.maxCustomers! - a.s.customers / a.limits.maxCustomers!)[0];
    if (closest) parts.push(`${closest.name} at ${closest.s.customers} of ${closest.limits.maxCustomers} customers`);
    return parts.join(' · ');
  });

  protected countryLabel(o: Organization) {
    if (!o.countries.length) return '—';
    const first = this.store.countries.find((c) => c.code === o.countries[0])?.name ?? o.countries[0];
    return o.countries.length > 1 ? `${first} +${o.countries.length - 1}` : first;
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
    void this.load();
  }

  // ── Row actions (shared with the detail) ──
  protected readonly confirm = signal<{ kind: 'suspend' | 'reactivate'; org: Organization } | null>(null);
  protected readonly confirmOpen = signal(false);
  protected readonly busy = signal(false);

  protected menu(o: Row): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Open', icon: 'eye', run: () => this.open(o.id) },
      { label: 'View as this organization', icon: 'building-2', run: () => this.viewAs(o) },
    ];
    if (!this.canWrite() || o.kind === 'Platform') return items;
    if (o.status === 'Invited') items.push({ label: 'Resend invitation', icon: 'send', run: () => void this.resend(o) });
    items.push(
      o.status === 'Suspended'
        ? { label: 'Reactivate', icon: 'play', run: () => this.ask('reactivate', o) }
        : { label: 'Suspend', icon: 'pause', danger: true, run: () => this.ask('suspend', o) },
    );
    if (o.status !== 'Active') items.push({ label: 'Delete…', icon: 'trash', danger: true, run: () => this.askDelete(o) });
    return items;
  }

  viewAs(o: Organization) {
    this.store.activeOrgId.set(o.id);
    this.router.navigate(['/dashboard']);
  }

  async resend(o: Organization) {
    try {
      const to = await this.api.resendInvitation(o.id);
      this.toast.show('Invitation sent again', { body: `${to.join(', ') || o.contact.email} has a new sign-in link, valid for 7 days.` });
    } catch (err) {
      this.toast.error("Couldn't resend the invitation", errorText(err));
    }
  }

  ask(kind: 'suspend' | 'reactivate', org: Organization) {
    this.confirm.set({ kind, org });
    this.confirmOpen.set(true);
  }

  protected readonly confirmCopy = computed(() => {
    const c = this.confirm();
    if (!c) return { title: '', body: '', action: '' };
    const s = statsOf(this.list().find((o) => o.id === c.org.id) ?? c.org);
    const users = s.users;
    if (c.kind === 'suspend') {
      return {
        title: `Suspend ${c.org.name}?`,
        body: `Its ${users} ${users === 1 ? 'user is' : 'users are'} signed out and can't sign in while it is suspended. Their ${s.customers} customers and ${s.inService} devices in service keep running, and nothing is deleted. You can reactivate it at any time.`,
        action: 'Suspend organization',
      };
    }
    return { title: `Reactivate ${c.org.name}?`, body: `Its ${users} ${users === 1 ? 'user' : 'users'} can sign in again straight away.`, action: 'Reactivate' };
  });

  protected async runConfirm() {
    const c = this.confirm();
    if (!c || this.busy()) return;
    this.busy.set(true);
    try {
      await this.setStatus(c.kind, c.org);
      this.confirmOpen.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  private async setStatus(kind: 'suspend' | 'reactivate', org: Organization, undo = false) {
    try {
      const saved = kind === 'suspend' ? await this.api.suspend(org.id) : await this.api.reactivate(org.id);
      this.store.saveOrganization(saved);
      this.list.update((xs) => xs.map((x) => (x.id === saved.id ? saved : x)));
      this.detailVersion.update((v) => v + 1);
      void this.session.refreshOrganizations();
      if (undo) return;
      if (kind === 'suspend') {
        this.toast.show(`${org.name} suspended`, {
          body: 'Its users are signed out and can’t sign in.',
          action: { label: 'Undo', run: () => void this.setStatus('reactivate', saved, true) },
        });
      } else {
        this.toast.show(`${org.name} reactivated`, { body: saved.status === 'Invited' ? 'Nobody there has accepted an invitation yet.' : undefined });
      }
    } catch (err) {
      this.toast.error(kind === 'suspend' ? `Couldn't suspend ${org.name}` : `Couldn't reactivate ${org.name}`, errorText(err));
    }
  }

  /** Bumped after a status change so an open detail reloads. */
  protected readonly detailVersion = signal(0);

  // ── Delete (through the deletion audit) ──
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Organization | null>(null);
  protected readonly deleteReason = signal('');
  protected readonly deleteError = signal('');
  askDelete(o: Organization) {
    this.deleteTarget.set(o);
    this.deleteReason.set('');
    this.deleteError.set('');
    this.deleteOpen.set(true);
  }
  protected async requestDelete() {
    const o = this.deleteTarget();
    if (!o || this.busy()) return;
    this.busy.set(true);
    this.deleteError.set('');
    try {
      await this.audit.request('organization', o.id, this.deleteReason());
      this.deleteOpen.set(false);
      this.toast.show('Deletion requested', { body: `Someone else with edit access to the deletion audit approves it. ${o.name} stays until then.` });
    } catch (err) {
      this.deleteError.set(errorText(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async created(o: Organization) {
    await this.load();
    void this.session.refreshOrganizations();
    this.open(o.id);
  }
}
