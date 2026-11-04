import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, DateTimePipe, RelativePipe, TonePipe } from '../../core/data/format';
import { Device, DeviceStatus, DeviceType, PackageName } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { CountUp, SpotlightBorder } from '@iotility/shared-ui';
import { downloadCsv } from '../../shared/ui/csv';
import { Access } from '../../core/access/access';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';
import { simulateLoad } from '../../shared/ui/loading';
import { STATUS_LABEL } from './device-status';
import { DEVICE_ID_RE, IMEI_RE, IMPORT_COLUMNS, ImportRow, MSISDN_RE, SIM_RE, toDevice, validateImport } from './device-import';
import { Select, SelectOption } from '../../shared/ui/select';

type StatusFilter = DeviceStatus | 'all';
interface Owner {
  name: string;
  link: (string | number)[];
  kind: string;
  query: Record<string, string> | null;
}
type Row = Device & { type: DeviceType; owner: Owner | null; package: PackageName | null };
type BulkAction = 'faulty' | 'deactivate' | 'stock';


/** Which statuses each action may start from (legacy offered impossible moves, e.g. Deactivated → Sold). */
const FROM: Record<BulkAction | 'allocate', DeviceStatus[]> = {
  allocate: ['Available'],
  faulty: ['Available', 'Allocated', 'Sold'],
  deactivate: ['Allocated', 'Sold'],
  stock: ['Allocated', 'Sold', 'Deactivated', 'Faulty'],
};

/**
 * Inventory — "What stock do we have and where is each device?"
 * Count cards filter by lifecycle state; the table answers "where" (owner, SIM) per device.
 * Select rows to allocate, retire or return them in bulk; click a row for its history.
 */
@Component({
  selector: 'app-inventory-list',
  imports: [Select, SelectOption, RouterLink, Icon, Pager, Menu, Dialog, CountUp, SpotlightBorder, DatePipe, DateTimePipe, RelativePipe, TonePipe, OrgTag, OrgFilter, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-list.html',
  styleUrl: './inventory-list.css',
})
export class InventoryList {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('inventory');
  protected readonly accessSvc = inject(Access);
  protected readonly access = writeAccess('Inventory');
  protected readonly orgs = orgContext();
  protected readonly orgId = signal<number | null>(null);

  /** ?q= from the global search. */
  readonly qParam = input<string | undefined>(undefined, { alias: 'q' });

  protected readonly status = signal<StatusFilter>('all');
  protected readonly pkg = signal<PackageName | 'all'>('all');
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly label = STATUS_LABEL;
  protected readonly statuses: DeviceStatus[] = ['Available', 'Allocated', 'Sold', 'Deactivated', 'Faulty'];
  protected readonly packages: PackageName[] = ['Basic', 'Plug & Go', 'Advance', 'Enterprise'];

  constructor() {
    effect(() => {
      const q = this.qParam();
      if (q) this.q.set(q);
    });
    effect(() => {
      this.status();
      this.pkg();
      this.q();
      this.orgId();
      this.page.set(1);
    });
  }

  // ── Lookups ────────────────────────────────────────────────
  private readonly customers = computed(() => new Map(this.store.customers().map((c) => [c.id, c])));
  private readonly consumers = computed(() => new Map(this.store.consumers().map((c) => [c.id, c])));
  private readonly types = computed(() => new Map(this.store.deviceTypes().map((t) => [t.id, t])));

  /** A device's package is its owner's; a consumer device runs Plug & Go; stock has none yet. */
  private packageOf(d: Device): PackageName | null {
    if (d.customerId != null) return this.customers().get(d.customerId)?.package ?? null;
    if (d.consumerId != null) return 'Plug & Go';
    return null;
  }

  protected readonly all = computed((): Row[] =>
    this.store.devices().map((d) => {
      const type = this.types().get(d.typeId)!;
      const customer = d.customerId != null ? this.customers().get(d.customerId) : undefined;
      const consumer = d.consumerId != null ? this.consumers().get(d.consumerId) : undefined;
      return {
        ...d,
        type,
        owner: customer
          ? { name: customer.company, link: ['/customers', customer.id], kind: customer.customerType as string, query: null }
          : consumer
            ? { name: consumer.name, link: ['/consumers'], kind: 'Consumer', query: { q: consumer.name } }
            : null,
        package: this.packageOf(d),
      };
    }),
  );
  protected readonly byId = computed(() => new Map(this.all().map((r) => [r.id, r])));

  /** After search and package, before status: the count cards are computed from this. */
  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const qd = q.replace(/[\s+]/g, '');
    const p = this.pkg();
    const org = this.orgs.showOrg() ? this.orgId() : null;
    return this.all().filter((d) => {
      if (org != null && d.orgId !== org) return false;
      // Stock (no owner yet) matches a package when its type can serve it.
      if (p !== 'all' && (d.package ? d.package !== p : !d.type.packages.includes(p))) return false;
      if (!q) return true;
      return (
        d.id.toLowerCase().includes(q) ||
        (qd.length >= 3 && (d.imei.includes(qd) || d.simSn.includes(qd) || d.msisdn.includes(qd))) ||
        (d.plate ?? '').toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        (d.owner?.name.toLowerCase().includes(q) ?? false)
      );
    });
  });

  protected readonly counts = computed(() => {
    const m: Record<StatusFilter, number> = { all: 0, Available: 0, Allocated: 0, Sold: 0, Deactivated: 0, Faulty: 0 };
    for (const d of this.searched()) {
      m.all++;
      m[d.status]++;
    }
    return m;
  });

  protected readonly rows = computed(() => {
    const s = this.status();
    return this.searched().filter((d) => s === 'all' || d.status === s);
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));
  protected readonly statusNoun = computed(() => {
    const s = this.status();
    return s === 'all' ? '' : `${STATUS_LABEL[s].toLowerCase()} `;
  });

  /** The finding under the title: stock that can ship today vs. devices that need a look. */
  protected readonly subline = computed(() => {
    const all = this.store.devices();
    const avail = all.filter((d) => d.status === 'Available').length;
    const faulty = all.filter((d) => d.status === 'Faulty').length;
    return `${all.length} devices · ${avail} ready to allocate · ${faulty} faulty`;
  });

  // ── Selection ──────────────────────────────────────────────
  protected readonly selectedRows = computed(() =>
    [...this.selected()].map((id) => this.byId().get(id)).filter((d): d is Row => !!d),
  );
  protected readonly selectedParam = computed(() => [...this.selected()].join(','));
  protected readonly pageAllSelected = computed(
    () => this.pageRows().length > 0 && this.pageRows().every((d) => this.selected().has(d.id)),
  );
  protected readonly pageSomeSelected = computed(
    () => !this.pageAllSelected() && this.pageRows().some((d) => this.selected().has(d.id)),
  );
  protected readonly eligible = computed(() => {
    const rows = this.selectedRows();
    const n = (a: keyof typeof FROM) => rows.filter((d) => FROM[a].includes(d.status)).length;
    return { allocate: n('allocate'), faulty: n('faulty'), deactivate: n('deactivate'), stock: n('stock') };
  });

  protected toggle(id: string, on: boolean) {
    this.selected.update((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  protected togglePage(on: boolean) {
    this.selected.update((s) => {
      const n = new Set(s);
      for (const d of this.pageRows()) {
        if (on) n.add(d.id);
        else n.delete(d.id);
      }
      return n;
    });
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }

  // ── Status changes (bulk and per row) ──────────────────────
  private snapshot(ids: string[]) {
    const set = new Set(ids);
    return this.store.devices().filter((d) => set.has(d.id));
  }
  private restore(before: Device[]) {
    const m = new Map(before.map((d) => [d.id, d]));
    this.store.devices.update((xs) => xs.map((d) => m.get(d.id) ?? d));
  }

  protected apply(action: BulkAction, ids = [...this.selected()]) {
    const devs = ids.map((id) => this.byId().get(id)!).filter(Boolean);
    const ok = devs.filter((d) => FROM[action].includes(d.status)).map((d) => d.id);
    if (!ok.length) return;
    const before = this.snapshot(ok);
    const to: DeviceStatus = action === 'faulty' ? 'Faulty' : action === 'deactivate' ? 'Deactivated' : 'Available';
    this.store.setDeviceStatus(ok, to);
    const verb = { faulty: 'marked faulty', deactivate: 'deactivated', stock: 'returned to stock' }[action];
    const skipped = devs.length - ok.length;
    this.toast.show(`${ok.length} ${ok.length === 1 ? 'device' : 'devices'} ${verb}`, {
      body: skipped ? `${skipped} skipped: their status doesn't allow it.` : undefined,
      action: { label: 'Undo', run: () => this.restore(before) },
    });
    this.clearSelection();
  }

  protected menu(d: Row): MenuItem[] {
    const view: MenuItem = { label: 'View details', icon: 'eye', run: () => this.openDetail(d.id) };
    if (!this.access.rw()) return [view];
    return [
      view,
      { label: 'Allocate to customer', icon: 'building', disabled: !FROM.allocate.includes(d.status), run: () => this.openAllocate([d.id]) },
      { label: 'Mark faulty', icon: 'alert', disabled: !FROM.faulty.includes(d.status), run: () => this.apply('faulty', [d.id]) },
      { label: 'Deactivate', icon: 'power', disabled: !FROM.deactivate.includes(d.status), run: () => this.apply('deactivate', [d.id]) },
      { label: 'Return to stock', icon: 'refresh', disabled: !FROM.stock.includes(d.status), danger: d.status === 'Sold', run: () => this.apply('stock', [d.id]) },
    ];
  }

  // ── Allocate dialog ────────────────────────────────────────
  protected readonly allocOpen = signal(false);
  protected readonly allocIds = signal<string[]>([]);
  protected readonly allocCustomer = signal<number | null>(null);
  protected readonly allocTouched = signal(false);

  protected openAllocate(ids = [...this.selected()]) {
    this.allocIds.set(ids.filter((id) => this.byId().get(id)?.status === 'Available'));
    this.allocCustomer.set(null);
    this.allocTouched.set(false);
    this.allocOpen.set(true);
  }
  protected readonly allocTypes = computed(() => {
    const ids = new Set(this.allocIds().map((id) => this.byId().get(id)?.typeId));
    return this.store.deviceTypes().filter((t) => ids.has(t.id));
  });
  /** Active customers whose package every selected device type supports. */
  protected readonly allocCustomers = computed(() => {
    const types = this.allocTypes();
    // Devices only go to customers of the organization that owns them.
    const orgIds = new Set(this.allocIds().map((id) => this.byId().get(id)?.orgId));
    return this.store
      .customers()
      .filter((c) => orgIds.size === 1 && orgIds.has(c.orgId))
      .filter((c) => c.status === 'Active' && types.every((t) => t.packages.includes(c.package)))
      .sort((a, b) => a.company.localeCompare(b.company));
  });
  protected allocate() {
    this.allocTouched.set(true);
    const cid = this.allocCustomer();
    const ids = this.allocIds();
    if (cid == null || !ids.length) return;
    const before = this.snapshot(ids);
    this.store.allocate(ids, cid);
    this.toast.show(`${ids.length} ${ids.length === 1 ? 'device' : 'devices'} allocated`, {
      body: `To ${this.store.customer(cid)?.company}.`,
      action: { label: 'Undo', run: () => this.restore(before) },
    });
    this.allocOpen.set(false);
    this.clearSelection();
  }

  // ── Detail drawer ──────────────────────────────────────────
  protected readonly detailOpen = signal(false);
  protected readonly detailId = signal<string | null>(null);
  protected readonly detail = computed(() => (this.detailId() ? this.byId().get(this.detailId()!) : undefined));
  protected readonly history = computed(() => {
    const d = this.detail();
    return d ? this.store.deviceHistory(d) : [];
  });
  protected openDetail(id: string) {
    this.detailId.set(id);
    this.detailOpen.set(true);
  }
  protected readonly can = (d: { status: DeviceStatus }, a: keyof typeof FROM) => FROM[a].includes(d.status);

  // ── Add device dialog ──────────────────────────────────────
  protected readonly addOpen = signal(false);
  protected readonly addTried = signal(false);
  protected readonly form = {
    id: signal(''),
    imei: signal(''),
    typeId: signal<number | null>(null),
    simSn: signal(''),
    msisdn: signal(''),
  };
  protected openAdd() {
    this.form.id.set('');
    this.form.imei.set('');
    this.form.typeId.set(null);
    this.form.simSn.set('');
    this.form.msisdn.set('');
    this.addTried.set(false);
    this.addOpen.set(true);
  }
  protected readonly addErrors = computed(() => {
    const f = this.form;
    const id = f.id().trim().toUpperCase();
    const imei = f.imei().trim();
    const devices = this.store.devices();
    const e: Partial<Record<'id' | 'imei' | 'type' | 'sim' | 'msisdn', string>> = {};
    if (!id) e.id = 'Enter the device ID printed on the label.';
    else if (!DEVICE_ID_RE.test(id)) e.id = 'Use 3–20 letters, digits or dashes.';
    else if (devices.some((d) => d.id.toUpperCase() === id)) e.id = `${id} is already in stock.`;
    if (!imei) e.imei = 'Enter the 15-digit IMEI.';
    else if (!IMEI_RE.test(imei)) e.imei = `IMEI must be 15 digits (${imei.replace(/\D/g, '').length} entered).`;
    else if (devices.some((d) => d.imei === imei)) e.imei = 'Another device already has this IMEI.';
    if (f.typeId() == null) e.type = 'Choose a device type.';
    if (f.simSn().trim() && !SIM_RE.test(f.simSn().trim())) e.sim = 'SIM serial numbers are 18–20 digits.';
    if (f.msisdn().trim() && !MSISDN_RE.test(f.msisdn().trim().replace(/^\+/, ''))) e.msisdn = 'Use 8–15 digits with the country code, no spaces.';
    return e;
  });
  protected addDevice() {
    this.addTried.set(true);
    if (Object.keys(this.addErrors()).length) return;
    const f = this.form;
    const dev: Device = {
      orgId: this.store.writeOrgId(),
      id: f.id().trim().toUpperCase(),
      imei: f.imei().trim(),
      typeId: f.typeId()!,
      customerId: null,
      consumerId: null,
      status: 'Available',
      simSn: f.simSn().trim(),
      msisdn: f.msisdn().trim().replace(/^\+/, ''),
      createdAt: this.store.today.toISOString(),
      lastSeen: null,
      plate: null,
    };
    this.store.addDevices([dev]);
    this.toast.show(`${dev.id} added to stock`, { action: { label: 'Undo', run: () => this.remove([dev.id]) } });
    this.addOpen.set(false);
  }
  private remove(ids: string[]) {
    const set = new Set(ids);
    this.store.devices.update((xs) => xs.filter((d) => !set.has(d.id)));
  }

  // ── Bulk upload dialog ─────────────────────────────────────
  protected readonly uploadOpen = signal(false);
  protected readonly fileName = signal<string | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly importRows = signal<ImportRow[]>([]);
  protected readonly dragging = signal(false);
  protected readonly validRows = computed(() => this.importRows().filter((r) => !r.errors.length));
  protected readonly badRows = computed(() => this.importRows().filter((r) => r.errors.length));

  protected openUpload() {
    this.fileName.set(null);
    this.fileError.set(null);
    this.importRows.set([]);
    this.uploadOpen.set(true);
  }
  protected onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const files = e.dataTransfer?.files;
    if (files?.length) this.read(files[0], files.length);
  }
  protected onPick(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) this.read(input.files[0], input.files.length);
    input.value = '';
  }
  private async read(file: File, count: number) {
    this.fileName.set(file.name);
    this.importRows.set([]);
    if (count > 1) return this.fileError.set('Drop one file at a time.');
    if (!/\.csv$/i.test(file.name)) return this.fileError.set('Upload a .csv file. In Excel, use File › Save as › CSV.');
    if (file.size > 2 * 1024 * 1024) return this.fileError.set('The file is over 2 MB. Split it into smaller batches.');
    const { rows, error } = validateImport(await file.text(), this.store.deviceTypes(), this.store.devices());
    this.fileError.set(error);
    this.importRows.set(rows);
  }
  protected downloadTemplate() {
    const t = this.store.deviceTypes();
    downloadCsv('inventory-template.csv', [
      { device_id: 'DEV-20001', imei: '356307042441013', type: t[0].name, sim_sn: '8997101000000000001', msisdn: '971500000001' },
      { device_id: 'DC-20002', imei: '356307042441021', type: t[4].name, sim_sn: '', msisdn: '' },
    ]);
  }
  protected downloadErrors() {
    downloadCsv(
      'inventory-rows-with-errors.csv',
      this.badRows().map((r) => ({ line: r.line, device_id: r.deviceId, imei: r.imei, type: r.type, sim_sn: r.simSn, msisdn: r.msisdn, errors: r.errors.join('; ') })),
    );
  }
  protected importValid() {
    const ids = this.validRows().map((r) => r.deviceId);
    if (!ids.length) return;
    const at = this.store.today.toISOString();
    this.store.addDevices(this.validRows().map((r) => toDevice(r, at, this.store.writeOrgId())));
    const skipped = this.badRows().length;
    this.toast.show(`${ids.length} ${ids.length === 1 ? 'device' : 'devices'} imported`, {
      body: skipped ? `${skipped} rows with errors were skipped.` : undefined,
      action: { label: 'Undo', run: () => this.remove(ids) },
    });
    this.uploadOpen.set(false);
  }
  protected readonly importColumns = IMPORT_COLUMNS;

  // ── Export ─────────────────────────────────────────────────
  protected export() {
    downloadCsv(
      `inventory-${this.store.today.toISOString().slice(0, 10)}.csv`,
      this.rows().map((d) => ({
        'Device ID': d.id,
        ...(this.orgs.showOrg() ? { Organization: this.orgs.name(d.orgId) } : {}),
        IMEI: d.imei, Type: d.type.name, Category: d.type.category,
        Owner: d.owner?.name ?? '', 'Owner type': d.owner?.kind ?? '', Package: d.package ?? '',
        Status: STATUS_LABEL[d.status], 'SIM SN': d.simSn, MSISDN: d.msisdn, Plate: d.plate ?? '', Created: d.createdAt.slice(0, 10),
      })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} devices saved as CSV.`, tone: 'info' });
  }

  protected clearFilters() {
    this.q.set('');
    this.pkg.set('all');
    this.status.set('all');
    this.orgId.set(null);
  }

  /** Owner links only for screens the user can open. */
  protected ownerLinkable(link: unknown[]) {
    return this.accessSvc.can(this.accessSvc.featureForUrl(String(link[0])) ?? '');
  }
}
