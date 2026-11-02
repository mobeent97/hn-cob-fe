import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { DatePipe, RelativePipe, fmtDate } from '../../core/data/format';
import { Customer, DeletionAudit } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';

/**
 * Deletion audit — "Which customer deletions are waiting for me, and who removed which accounts?"
 * Pending requests sit above the log because they are the only thing here that needs action.
 * Device lists are real arrays (the legacy API sent a Python-repr string the client had to parse).
 */
@Component({
  selector: 'app-audit',
  imports: [Icon, Pager, Dialog, DatePipe, RelativePipe, OrgTag, OrgFilter, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.html',
  styleUrl: './audit.scss',
})
export class Audit {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('audit');

  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  /** Approving or cancelling a deletion needs read/write on the Audit feature. */
  protected readonly access = writeAccess('Audit');
  protected readonly canApprove = this.access.rw;
  protected readonly orgs = orgContext();
  protected readonly orgId = signal<number | null>(null);

  constructor() {
    effect(() => {
      this.q();
      this.orgId();
      this.page.set(1);
    });
  }

  // ── Pending requests ───────────────────────────────────────
  protected readonly pending = computed(() =>
    this.store
      .customers()
      .filter((c) => c.deletionStatus === 'Requested')
      .map((c) => ({ ...c, devices: this.store.devicesByCustomer().get(c.id) ?? [] })),
  );

  protected readonly approveOpen = signal(false);
  protected readonly target = signal<(Customer & { devices: { id: string }[] }) | null>(null);

  protected askApprove(c: Customer & { devices: { id: string }[] }) {
    this.target.set(c);
    this.approveOpen.set(true);
  }

  protected approve() {
    const c = this.target();
    if (!c) return;
    const me = this.store.currentUser().name;
    const ids = c.devices.map((d) => d.id);
    const row: DeletionAudit = {
      orgId: c.orgId,
      id: Math.max(0, ...this.store.audit.all().map((a) => a.id)) + 1,
      customer: c.company,
      email: c.email,
      deletedBy: me,
      approvedBy: me,
      createdAt: c.createdAt,
      deletedAt: new Date().toISOString(),
      devices: ids,
    };
    // Devices return to stock; the customer leaves the platform; the audit keeps the record.
    this.store.setDeviceStatus(ids, 'Available');
    this.store.customers.update((xs) => xs.filter((x) => x.id !== c.id));
    this.store.audit.update((xs) => [row, ...xs]);
    this.approveOpen.set(false);
    this.toast.show(`${c.company} deleted`, { body: `${ids.length} devices returned to stock. The deletion is in the audit log.` });
  }

  protected cancel(c: Customer) {
    this.store.cancelDeletion(c.id);
    this.toast.show('Deletion request cancelled', { body: `${c.company} stays on the platform.`, action: { label: 'Undo', run: () => this.store.requestDeletion(c.id) } });
  }

  // ── Audit log ──────────────────────────────────────────────
  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const org = this.orgs.showOrg() ? this.orgId() : null;
    return this.store
      .audit()
      .filter((a) => org == null || a.orgId === org)
      .filter((a) => !q || [a.customer, a.email, a.deletedBy, a.approvedBy].some((x) => x.toLowerCase().includes(q)) || a.devices.some((d) => d.toLowerCase().includes(q)))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));
  protected readonly devicesRemoved = computed(() => this.store.audit().reduce((n, a) => n + a.devices.length, 0));

  protected readonly devicesOpen = signal(false);
  protected readonly shown = signal<DeletionAudit | null>(null);
  protected showDevices(a: DeletionAudit) {
    this.shown.set(a);
    this.devicesOpen.set(true);
  }
  protected async copyIds() {
    const a = this.shown();
    if (!a) return;
    await navigator.clipboard?.writeText(a.devices.join('\n')).catch(() => undefined);
    this.toast.show('Device IDs copied', { body: `${a.devices.length} IDs on the clipboard.`, tone: 'info' });
  }

  protected export() {
    downloadCsv(
      `deletion-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      this.rows().map((a) => ({
        Customer: a.customer,
        ...(this.orgs.showOrg() ? { Organization: this.orgs.name(a.orgId) } : {}),
        Email: a.email, 'Deleted by': a.deletedBy, 'Approved by': a.approvedBy,
        Created: fmtDate(a.createdAt), Deleted: fmtDate(a.deletedAt), Devices: a.devices.length, 'Device IDs': a.devices.join(' '),
      })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} deletions saved as CSV.`, tone: 'info' });
  }
}
