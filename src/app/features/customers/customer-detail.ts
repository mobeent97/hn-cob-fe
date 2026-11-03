import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, DateTimePipe, RelativePipe, TonePipe, daysFrom, fmtDate, fmtMoney, MONTHS } from '../../core/data/format';
import { Customer, Device, ONBOARDING_STEPS } from '../../core/data/models';
import { Icon, IconName } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { CountUp } from '@iotility/shared-ui';
import { simulateLoad } from '../../shared/ui/loading';
import { fmtSize } from './onboarding';
import { OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';
import { Access } from '../../core/access/access';

type Tab = 'overview' | 'devices' | 'documents' | 'admins' | 'activity';
type Confirm = { kind: 'deactivate' | 'activate' | 'delete' | 'cancel-delete' } | null;
interface ActivityItem { at: string; icon: IconName; title: string; body?: string; by?: string; tone?: 'neg' | 'pos' }

const DAY = 86400000;

/**
 * Customer — "Is this customer live, and is their fleet healthy?"
 * Object header with the lifecycle actions; tabs split the record so the overview stays short.
 */
@Component({
  selector: 'app-customer-detail',
  imports: [RouterLink, Icon, Tabs, Pager, Menu, Dialog, CountUp, DatePipe, DateTimePipe, RelativePipe, TonePipe, OrgTag, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.css',
})
export class CustomerDetail {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('customer-detail');
  protected readonly accessSvc = inject(Access);
  protected readonly access = writeAccess('Customers');
  /** Cancelling a deletion request is an Audit action. */
  protected readonly auditRw = writeAccess('Audit').rw;
  protected readonly orgs = orgContext();
  /** Platform users see which organization owns the customer; partners know it already. */
  protected readonly showOwner = this.store.crossTenant;

  readonly id = input<string>();
  /** ?tab=devices etc. for deep links from other screens. */
  readonly tabParam = input<Tab | undefined>(undefined, { alias: 'tab' });

  protected readonly steps = ONBOARDING_STEPS;
  protected readonly fmtSize = fmtSize;
  protected readonly daysFrom = daysFrom;

  protected readonly customer = computed(() => this.store.customer(Number(this.id())));
  protected readonly country = computed(() => {
    const c = this.customer();
    return c ? this.store.country(c.countryCode) : undefined;
  });
  protected readonly devices = computed<Device[]>(() => {
    const c = this.customer();
    return c ? (this.store.devicesByCustomer().get(c.id) ?? []) : [];
  });
  protected readonly counts = computed(() => {
    const m = { Sold: 0, Allocated: 0, Faulty: 0, Deactivated: 0 };
    for (const d of this.devices()) if (d.status in m) m[d.status as keyof typeof m]++;
    return m;
  });
  protected readonly price = computed(() => this.store.packages().find((p) => p.name === this.customer()?.package)?.monthlyPrice ?? 0);
  protected readonly monthly = computed(() => this.counts().Sold * this.price());
  protected readonly fmtMoney = fmtMoney;

  protected readonly tab = signal<Tab>('overview');
  protected readonly tabs = computed<TabItem<Tab>[]>(() => {
    const c = this.customer();
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'devices', label: 'Devices', count: this.devices().length },
      { id: 'documents', label: 'Documents', count: c?.documents.length ?? 0 },
      { id: 'admins', label: 'Admins', count: c?.admins.length ?? 0 },
      { id: 'activity', label: 'Activity' },
    ];
  });

  // ── Devices tab ───────────────────────────────────────────
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  protected readonly deviceRows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.devices()
      .filter(
        (d) =>
          !q ||
          d.id.toLowerCase().includes(q) ||
          d.imei.includes(q) ||
          (d.plate ?? '').toLowerCase().includes(q) ||
          this.store.deviceType(d.typeId).name.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.id.localeCompare(b.id));
  });
  protected readonly pageRows = computed(() => pageOf(this.deviceRows(), this.page(), this.size()));

  // ── Confirm dialog ────────────────────────────────────────
  protected readonly confirm = signal<Confirm>(null);
  protected readonly confirmOpen = signal(false);

  constructor() {
    effect(() => {
      this.q();
      this.page.set(1);
    });
    // A different customer (or a ?tab= link) picks the tab; otherwise the overview.
    effect(() => {
      this.id();
      const t = this.tabParam();
      this.tab.set(t && ['overview', 'devices', 'documents', 'admins', 'activity'].includes(t) ? t : 'overview');
    });
  }

  protected readonly statusPill = computed(() => {
    const c = this.customer();
    if (!c) return { label: '', tone: '' };
    if (c.deletionStatus === 'Requested') return { label: 'Deletion requested', tone: 'negative' };
    if (c.status === 'Active' && c.stepsDone < 9) return { label: `Onboarding ${c.stepsDone}/9`, tone: 'info' };
    return { label: c.status, tone: c.status === 'Active' ? 'positive' : '' };
  });

  protected readonly subline = computed(() => {
    const c = this.customer();
    if (!c) return '';
    const n = this.counts();
    if (c.stepsDone < 9) return `Onboarding: ${c.stepsDone} of 9 sections done, next is ${ONBOARDING_STEPS[c.stepsDone]}.`;
    if (c.status === 'Inactive') return 'Account deactivated: users can’t sign in and devices don’t report.';
    if (n.Faulty) return `${n.Faulty} faulty ${n.Faulty === 1 ? 'device needs' : 'devices need'} replacing.`;
    if (n.Allocated) return `${n.Allocated} allocated ${n.Allocated === 1 ? 'device is' : 'devices are'} waiting for installation.`;
    return `All ${n.Sold} devices are in service.`;
  });

  protected expiryNote(c: Customer) {
    const d = daysFrom(c.contractExpiry);
    return d < 0 ? 'expired' : d <= 60 ? `in ${d} days` : '';
  }

  /** A believable timeline derived from the record: created, sections, documents, devices, status. */
  protected readonly activity = computed<ActivityItem[]>(() => {
    const c = this.customer();
    if (!c) return [];
    const today = this.store.today.getTime();
    const created = new Date(c.createdAt).getTime();
    const age = Math.max(1, (today - created) / DAY);
    // Complete customers took up to three weeks; ones still onboarding are spread over their age so far.
    const span = c.stepsDone === 9 ? Math.min(21, age * 0.6) : age * 0.85;
    const stepAt = (k: number) => new Date(created + ((k + 1) / 9) * span * DAY + (k + 1) * 3_600_000).toISOString();
    const out: ActivityItem[] = [{ at: c.createdAt, icon: 'building', title: 'Customer created', body: `${c.company} added to the portal`, by: 'Hira Qureshi' }];

    for (let k = 0; k < c.stepsDone; k++) {
      out.push({
        at: stepAt(k),
        icon: k === 8 ? 'circle-check' : 'check',
        title: k === 8 ? 'Onboarding complete' : `${ONBOARDING_STEPS[k]} completed`,
        body: k === 2 ? `${c.package} package` : k === 3 ? `${c.customerType} customer` : k === 5 && c.admins.length ? `${c.admins.length} ${c.admins.length === 1 ? 'admin' : 'admins'} invited` : undefined,
        by: k < 6 ? 'Hira Qureshi' : 'Ahmed Al Hashimi',
        tone: k === 8 ? 'pos' : undefined,
      });
    }
    for (const d of c.documents) out.push({ at: d.uploadedAt, icon: 'paperclip', title: `${d.name} uploaded`, body: `${d.kind} · ${fmtSize(d.sizeKb)}`, by: 'Hira Qureshi' });

    // Devices: the first batch lands when Hardware is done; later top-ups are grouped by quarter.
    const hwAt = c.stepsDone >= 7 ? new Date(stepAt(6)).getTime() : today;
    const allocAt = (d: Device) => Math.min(today, Math.max(hwAt, new Date(d.createdAt).getTime() + 2 * DAY));
    const batches = new Map<string, Device[]>();
    for (const d of this.devices()) {
      const t = allocAt(d);
      const at = new Date(t);
      const key = t - hwAt < 14 * DAY ? 'first' : `${at.getFullYear()}-Q${Math.floor(at.getMonth() / 3)}`;
      (batches.get(key) ?? batches.set(key, []).get(key)!).push(d);
    }
    for (const [key, ds] of batches) {
      const at = new Date(Math.max(...ds.map(allocAt))).toISOString();
      const live = ds.filter((d) => d.status === 'Sold').length;
      const types = [...new Set(ds.map((d) => this.store.deviceType(d.typeId).name))].slice(0, 3).join(', ');
      out.push({
        at,
        icon: 'cpu',
        title: `${ds.length} ${ds.length === 1 ? 'device' : 'devices'} allocated${key === 'first' ? '' : ' (top-up)'}`,
        body: `${types}${live ? ` · ${live} now in service` : ''}`,
        by: 'Usman Siddiqui',
      });
    }
    for (const d of this.devices().filter((x) => x.status === 'Faulty')) {
      out.push({ at: new Date(Math.min(today, allocAt(d) + 9 * DAY)).toISOString(), icon: 'alert', title: `${d.id} reported faulty`, body: 'No GPS fix after installation, returned for RMA', by: 'Grace Okafor', tone: 'neg' });
    }
    if (c.status === 'Inactive') {
      out.push({ at: new Date(today - 12 * DAY).toISOString(), icon: 'power', title: 'Account deactivated', body: 'Users signed out and devices stopped reporting', by: 'Mobeen Tahir', tone: 'neg' });
    }
    if (c.deletionStatus === 'Requested') {
      out.push({ at: new Date(today - 2 * DAY).toISOString(), icon: 'trash', title: 'Deletion requested', body: 'Waiting for a super admin to approve', by: 'Hira Qureshi', tone: 'neg' });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  });

  protected monthLabel(iso: string) {
    const d = new Date(iso);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  protected readonly fmtDate = fmtDate;

  // ── Actions ───────────────────────────────────────────────
  protected readonly menu = computed<MenuItem[]>(() => {
    const c = this.customer();
    if (!c || !this.access.rw()) return [];
    return [
      c.status === 'Active'
        ? { label: 'Deactivate', icon: 'power', run: () => this.ask('deactivate') }
        : { label: 'Activate', icon: 'power', run: () => this.ask('activate') },
      c.deletionStatus === 'Requested'
        ? { label: 'Cancel deletion request', icon: 'x', disabled: !this.auditRw(), run: () => this.ask('cancel-delete') }
        : { label: 'Request deletion', icon: 'trash', danger: true, disabled: c.status === 'Active', run: () => this.ask('delete') },
    ];
  });

  private ask(kind: NonNullable<Confirm>['kind']) {
    this.confirm.set({ kind });
    this.confirmOpen.set(true);
  }

  protected readonly confirmCopy = computed(() => {
    const k = this.confirm()?.kind;
    const c = this.customer();
    if (!k || !c) return { title: '', body: '', action: '' };
    const n = this.devices().length;
    return {
      deactivate: { title: `Deactivate ${c.company}?`, body: `Their ${n} devices stop reporting and their users can't sign in. You can activate the account again later.`, action: 'Deactivate' },
      activate: { title: `Activate ${c.company}?`, body: 'Their users can sign in again and devices resume reporting.', action: 'Activate' },
      delete: { title: `Request deletion of ${c.company}?`, body: `A super admin must approve it. On approval the account and its ${n} device assignments are removed and recorded in the deletion audit.`, action: 'Request deletion' },
      'cancel-delete': { title: 'Cancel the deletion request?', body: `${c.company} stays on the platform as it is.`, action: 'Cancel request' },
    }[k];
  });

  protected runConfirm() {
    const k = this.confirm()?.kind;
    const c = this.customer();
    if (!k || !c) return;
    switch (k) {
      case 'deactivate':
        this.store.setCustomerStatus(c.id, 'Inactive');
        this.toast.show(`${c.company} deactivated`, { action: { label: 'Undo', run: () => this.store.setCustomerStatus(c.id, 'Active') } });
        break;
      case 'activate':
        this.store.setCustomerStatus(c.id, 'Active');
        this.toast.show(`${c.company} activated`);
        break;
      case 'delete':
        this.store.requestDeletion(c.id);
        this.toast.show('Deletion requested', { body: `${c.company} is waiting for a super admin to approve.` });
        break;
      case 'cancel-delete':
        this.store.cancelDeletion(c.id);
        this.toast.show('Deletion request cancelled');
        break;
    }
    this.confirmOpen.set(false);
  }

  /** Opens the wizard; with a section number it lands on that section when it's reachable. */
  protected edit(section?: number) {
    const c = this.customer();
    if (c) this.router.navigate(['/customers', c.id, 'edit'], section ? { queryParams: { section } } : {});
  }
  protected typeOf(d: Device) {
    return this.store.deviceType(d.typeId);
  }
}
