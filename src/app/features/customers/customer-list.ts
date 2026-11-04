import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, TonePipe, daysFrom } from '../../core/data/format';
import { Customer, PackageName } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { CountUp, SpotlightBorder } from '@iotility/shared-ui';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type View = 'all' | 'active' | 'onboarding' | 'inactive' | 'deletion';
type Sort = 'recent' | 'name' | 'devices' | 'expiry';
type Confirm = { kind: 'deactivate' | 'activate' | 'delete' | 'cancel-delete'; customer: Customer } | null;

/**
 * Customers — "Which customer do I need to act on?"
 * Count cards filter by package; underline tabs split by lifecycle state; one kebab per row.
 */
@Component({
  selector: 'app-customer-list',
  imports: [Select, SelectOption, RouterLink, Icon, Tabs, Pager, Menu, Dialog, CountUp, SpotlightBorder, DatePipe, TonePipe, OrgTag, OrgFilter, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-list.html',
  styleUrl: './customer-list.css',
})
export class CustomerList {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('customers');
  protected readonly orgs = orgContext();
  protected readonly access = writeAccess('Customers');
  /** Cancelling a deletion request is an Audit action. */
  protected readonly auditRw = writeAccess('Audit').rw;
  /** Organization filter (All organizations scope only). */
  protected readonly orgId = signal<number | null>(null);

  /** ?view=onboarding from the overview's "View all". */
  readonly viewParam = input<View | undefined>(undefined, { alias: 'view' });

  protected readonly view = signal<View>('all');
  protected readonly pkg = signal<PackageName | 'all'>('all');
  protected readonly q = signal('');
  protected readonly sort = signal<Sort>('recent');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  protected readonly confirm = signal<Confirm>(null);
  protected readonly confirmOpen = signal(false);

  protected readonly packages: PackageName[] = ['Basic', 'Plug & Go', 'Advance', 'Enterprise'];

  constructor() {
    effect(() => {
      const v = this.viewParam();
      if (v) this.view.set(v);
    });
    // Any change of filter returns to the first page.
    effect(() => {
      this.view();
      this.pkg();
      this.q();
      this.sort();
      this.orgId();
      this.page.set(1);
    });
  }

  private readonly matchesView = (c: Customer, v: View) =>
    v === 'all' ||
    (v === 'active' && c.status === 'Active' && c.stepsDone === 9) ||
    (v === 'onboarding' && c.status === 'Active' && c.stepsDone < 9) ||
    (v === 'inactive' && c.status === 'Inactive') ||
    (v === 'deletion' && c.deletionStatus === 'Requested');

  /** Rows after the search, before the package and view filters: counts are computed from this. */
  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const org = this.orgs.showOrg() ? this.orgId() : null;
    return this.store
      .customers()
      .filter((c) => org == null || c.orgId === org)
      .filter(
        (c) =>
          !q ||
          c.company.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          `${c.contact.firstName} ${c.contact.lastName}`.toLowerCase().includes(q) ||
          c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
      );
  });

  protected readonly packageCounts = computed(() => {
    const rows = this.searched().filter((c) => this.matchesView(c, this.view()));
    return {
      all: rows.length,
      ...Object.fromEntries(this.packages.map((p) => [p, rows.filter((c) => c.package === p).length])),
    } as Record<PackageName | 'all', number>;
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const rows = this.searched().filter((c) => this.pkg() === 'all' || c.package === this.pkg());
    const n = (v: View) => rows.filter((c) => this.matchesView(c, v)).length;
    return [
      { id: 'all', label: 'All', count: n('all') },
      { id: 'active', label: 'Live', count: n('active') },
      { id: 'onboarding', label: 'Onboarding', count: n('onboarding') },
      { id: 'inactive', label: 'Inactive', count: n('inactive') },
      { id: 'deletion', label: 'Deletion requested', count: n('deletion') },
    ];
  });

  protected readonly rows = computed(() => {
    const devices = this.store.devicesByCustomer();
    const rows = this.searched()
      .filter((c) => this.matchesView(c, this.view()))
      .filter((c) => this.pkg() === 'all' || c.package === this.pkg())
      .map((c) => ({ ...c, deviceCount: devices.get(c.id)?.filter((d) => d.status === 'Sold').length ?? 0 }));
    const by: Record<Sort, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.company.localeCompare(b.company),
      devices: (a, b) => b.deviceCount - a.deviceCount,
      expiry: (a, b) => a.contractExpiry.localeCompare(b.contractExpiry),
    };
    return rows.sort(by[this.sort()]);
  });

  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  protected expiryClass(iso: string) {
    const d = daysFrom(iso);
    return d < 0 ? 'neg' : d <= 60 ? 'warn' : '';
  }
  protected readonly daysFrom = daysFrom;

  protected menu(c: Customer): MenuItem[] {
    const view: MenuItem = { label: 'View details', icon: 'eye', run: () => this.router.navigate(['/customers', c.id]) };
    if (!this.access.rw()) return [view];
    return [
      view,
      { label: c.stepsDone < 9 ? 'Continue onboarding' : 'Edit', icon: 'pencil', run: () => this.router.navigate(['/customers', c.id, 'edit']) },
      c.status === 'Active'
        ? { label: 'Deactivate', icon: 'power', run: () => this.ask('deactivate', c) }
        : { label: 'Activate', icon: 'power', run: () => this.ask('activate', c) },
      c.deletionStatus === 'Requested'
        ? { label: 'Cancel deletion request', icon: 'x', disabled: !this.auditRw(), run: () => this.ask('cancel-delete', c) }
        : { label: 'Request deletion', icon: 'trash', danger: true, disabled: c.status === 'Active', run: () => this.ask('delete', c) },
    ];
  }

  private ask(kind: NonNullable<Confirm>['kind'], customer: Customer) {
    this.confirm.set({ kind, customer });
    this.confirmOpen.set(true);
  }

  protected confirmCopy = computed(() => {
    const c = this.confirm();
    if (!c) return { title: '', body: '', action: '' };
    const n = this.store.devicesByCustomer().get(c.customer.id)?.length ?? 0;
    return {
      deactivate: {
        title: `Deactivate ${c.customer.company}?`,
        body: `Their ${n} devices stop reporting and their users can't sign in. You can activate the account again later.`,
        action: 'Deactivate',
      },
      activate: { title: `Activate ${c.customer.company}?`, body: 'Their users can sign in again and devices resume reporting.', action: 'Activate' },
      delete: {
        title: `Request deletion of ${c.customer.company}?`,
        body: `A super admin must approve it. On approval the account and its ${n} device assignments are removed and recorded in the deletion audit.`,
        action: 'Request deletion',
      },
      'cancel-delete': { title: 'Cancel the deletion request?', body: `${c.customer.company} stays on the platform as it is.`, action: 'Cancel request' },
    }[c.kind];
  });

  protected runConfirm() {
    const c = this.confirm();
    if (!c) return;
    const id = c.customer.id;
    const name = c.customer.company;
    switch (c.kind) {
      case 'deactivate':
        this.store.setCustomerStatus(id, 'Inactive');
        this.toast.show(`${name} deactivated`, { action: { label: 'Undo', run: () => this.store.setCustomerStatus(id, 'Active') } });
        break;
      case 'activate':
        this.store.setCustomerStatus(id, 'Active');
        this.toast.show(`${name} activated`);
        break;
      case 'delete':
        this.store.requestDeletion(id);
        this.toast.show('Deletion requested', { body: `${name} is waiting for a super admin to approve.` });
        break;
      case 'cancel-delete':
        this.store.cancelDeletion(id);
        this.toast.show('Deletion request cancelled');
        break;
    }
    this.confirmOpen.set(false);
  }

  protected export() {
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      this.rows().map((c) => ({
        Company: c.company,
        ...(this.orgs.showOrg() ? { Organization: this.orgs.name(c.orgId) } : {}),
        Group: c.group, Email: c.email, Phone: c.phone, Country: this.store.country(c.countryCode).name,
        Zone: c.zone, Package: c.package, 'Customer type': c.customerType, Status: c.status,
        'Deletion status': c.deletionStatus, 'Devices in service': c.deviceCount, 'Contract expiry': c.contractExpiry,
      })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} customers saved as CSV.`, tone: 'info' });
  }
}
