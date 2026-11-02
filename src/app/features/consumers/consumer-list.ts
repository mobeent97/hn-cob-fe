import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Store } from '../../core/data/store';
import { DatePipe, RelativePipe, TonePipe } from '../../core/data/format';
import { Consumer, Device } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { downloadCsv } from '../../shared/ui/csv';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';
import { simulateLoad } from '../../shared/ui/loading';
import { EMAIL_RE, PHONE_RE, QID_RE, messageFor, notBlank, splitPhone } from '../customers/onboarding';

type StatusFilter = 'all' | 'Active' | 'Inactive';
type Sort = 'recent' | 'name' | 'devices';
const PLUG_AND_GO_TYPE = 2;

/**
 * Consumers — "Which individual owner needs a device or a status change?"
 * B2C owners of Plug & Go trackers: one table, a drawer per consumer for their devices.
 */
@Component({
  selector: 'app-consumer-list',
  imports: [ReactiveFormsModule, Icon, Pager, Menu, Dialog, AnimatedNumber, DatePipe, RelativePipe, TonePipe, OrgTag, OrgFilter, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './consumer-list.html',
  styleUrl: './consumer-list.scss',
})
export class ConsumerList {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly loading = simulateLoad('consumers');
  protected readonly orgs = orgContext();
  protected readonly access = writeAccess('Consumers');
  protected readonly orgId = signal<number | null>(null);

  protected readonly q = signal('');
  protected readonly status = signal<StatusFilter>('all');
  protected readonly sort = signal<Sort>('recent');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  constructor() {
    effect(() => {
      this.q();
      this.status();
      this.sort();
      this.orgId();
      this.page.set(1);
    });
  }

  // ── Figures ───────────────────────────────────────────────
  protected readonly total = computed(() => this.store.consumers().length);
  protected readonly active = computed(() => this.store.consumers().filter((c) => c.status === 'Active').length);
  protected readonly inService = computed(() => {
    let n = 0;
    for (const ds of this.store.devicesByConsumer().values()) n += ds.filter((d) => d.status === 'Sold').length;
    return n;
  });
  protected readonly withoutDevice = computed(
    () => this.store.consumers().filter((c) => c.status === 'Active' && !(this.store.devicesByConsumer().get(c.id)?.length)).length,
  );
  protected readonly stock = computed(() => this.store.devices().filter((d) => d.status === 'Available' && d.typeId === PLUG_AND_GO_TYPE));

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const qd = q.replace(/[\s+-]/g, '');
    const devices = this.store.devicesByConsumer();
    const org = this.orgs.showOrg() ? this.orgId() : null;
    const rows = this.store
      .consumers()
      .filter((c) => org == null || c.orgId === org)
      .filter((c) => this.status() === 'all' || c.status === this.status())
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (qd && c.phone.replace(/[\s+-]/g, '').includes(qd)) ||
          (qd && c.qid.replace(/-/g, '').includes(qd)),
      )
      .map((c) => ({ ...c, devices: devices.get(c.id)?.length ?? 0 }));
    const by: Record<Sort, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      devices: (a, b) => b.devices - a.devices,
    };
    return rows.sort(by[this.sort()]);
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  // ── Row actions ───────────────────────────────────────────
  protected menu(c: Consumer): MenuItem[] {
    const view: MenuItem = { label: 'View devices', icon: 'cpu', run: () => this.openDrawer(c) };
    if (!this.access.rw()) return [view];
    return [
      view,
      { label: 'Edit', icon: 'pencil', run: () => this.openForm(c) },
      c.status === 'Active'
        ? { label: 'Deactivate', icon: 'power', run: () => this.setStatus(c, 'Inactive') }
        : { label: 'Activate', icon: 'power', run: () => this.setStatus(c, 'Active') },
    ];
  }

  protected setStatus(c: Consumer, status: Consumer['status']) {
    const prev = c.status;
    this.store.consumers.update((xs) => xs.map((x) => (x.id === c.id ? { ...x, status } : x)));
    this.toast.show(`${c.name} ${status === 'Active' ? 'activated' : 'deactivated'}`, {
      body: status === 'Inactive' ? 'They can’t sign in to the app until you activate them again.' : undefined,
      action: { label: 'Undo', run: () => this.store.consumers.update((xs) => xs.map((x) => (x.id === c.id ? { ...x, status: prev } : x))) },
    });
  }

  // ── New / edit consumer dialog ────────────────────────────
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Consumer | null>(null);
  protected readonly submitted = signal(false);
  protected readonly form = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    lastName: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    email: ['', [Validators.required, Validators.pattern(EMAIL_RE)]],
    dial: ['+974'],
    phone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
    qid: ['', [Validators.required, Validators.pattern(QID_RE)]],
  });

  protected openForm(c: Consumer | null = null) {
    this.editing.set(c);
    this.submitted.set(false);
    if (c) {
      const [firstName, ...rest] = c.name.split(' ');
      const p = splitPhone(c.phone, '+974');
      this.form.reset({ firstName, lastName: rest.join(' '), email: c.email, dial: p.dial, phone: p.number, qid: c.qid });
    } else {
      this.form.reset({ firstName: '', lastName: '', email: '', dial: '+974', phone: '', qid: '' });
    }
    this.formOpen.set(true);
  }

  protected err(ctl: AbstractControl, label: string, hint?: string) {
    return ctl.invalid && (ctl.touched || this.submitted()) ? messageFor(ctl, label, hint) : null;
  }

  protected save() {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    const editing = this.editing();
    const email = v.email.trim().toLowerCase();
    if (email && this.store.consumers().some((c) => c.email.toLowerCase() === email && c.id !== editing?.id)) {
      this.form.controls.email.setErrors({ taken: 'A consumer with this email already exists.' });
    }
    const phone = `${v.dial} ${v.phone.trim()}`;
    if (v.phone && this.store.consumers().some((c) => c.phone.replace(/\s/g, '') === phone.replace(/\s/g, '') && c.id !== editing?.id)) {
      this.form.controls.phone.setErrors({ taken: 'Another consumer uses this phone number.' });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const name = `${v.firstName.trim()} ${v.lastName.trim()}`;
    if (editing) {
      this.store.consumers.update((xs) => xs.map((x) => (x.id === editing.id ? { ...x, name, email: v.email.trim(), phone, qid: v.qid.trim() } : x)));
      this.toast.show(`${name} updated`);
    } else {
      const id = Math.max(500, ...this.store.consumers.all().map((c) => c.id)) + 1;
      const c: Consumer = { id, orgId: this.store.writeOrgId(), name, email: v.email.trim(), phone, qid: v.qid.trim(), status: 'Active', createdAt: this.store.today.toISOString() };
      this.store.consumers.update((xs) => [c, ...xs]);
      this.toast.show(`${name} added`, { body: 'Allocate a Plug & Go device to get them tracking.', action: { label: 'Allocate', run: () => this.openDrawer(c) } });
    }
    this.formOpen.set(false);
  }

  // ── Drawer: a consumer's devices ──────────────────────────
  protected readonly drawerOpen = signal(false);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selected = computed(() => this.store.consumers().find((c) => c.id === this.selectedId()));
  protected readonly selectedDevices = computed<Device[]>(() => {
    const id = this.selectedId();
    return id ? (this.store.devicesByConsumer().get(id) ?? []) : [];
  });
  protected readonly pick = signal('');
  /** Stock the selected consumer can take: only devices of the consumer's own organization. */
  protected readonly pickStock = computed(() => {
    const org = this.selected()?.orgId;
    return this.stock().filter((d) => d.orgId === org);
  });

  protected openDrawer(c: Consumer) {
    this.selectedId.set(c.id);
    this.pick.set('');
    this.drawerOpen.set(true);
  }

  protected allocate() {
    const c = this.selected();
    const id = this.pick() || this.pickStock()[0]?.id;
    if (!c || !id) return;
    this.store.devices.update((xs) => xs.map((d) => (d.id === id ? { ...d, consumerId: c.id, customerId: null, status: 'Allocated' } : d)));
    this.pick.set('');
    this.toast.show(`${id} allocated to ${c.name}`, {
      body: 'It goes into service when they plug it in.',
      action: { label: 'Undo', run: () => this.release(id) },
    });
  }

  private release(id: string) {
    this.store.devices.update((xs) => xs.map((d) => (d.id === id ? { ...d, consumerId: null, status: 'Available', plate: null } : d)));
  }

  protected deallocate(d: Device) {
    const before = { ...d };
    this.release(d.id);
    this.toast.show(`${d.id} returned to stock`, {
      action: { label: 'Undo', run: () => this.store.devices.update((xs) => xs.map((x) => (x.id === d.id ? before : x))) },
    });
  }

  protected typeName(d: Device) {
    return this.store.deviceType(d.typeId).name;
  }

  protected export() {
    downloadCsv(
      `consumers-${this.store.today.toISOString().slice(0, 10)}.csv`,
      this.rows().map((c) => ({ Name: c.name, ...(this.orgs.showOrg() ? { Organization: this.orgs.name(c.orgId) } : {}), Email: c.email, Phone: c.phone, 'Q-ID': c.qid, Devices: c.devices, Status: c.status, Created: c.createdAt.slice(0, 10) })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} consumers saved as CSV.`, tone: 'info' });
  }
}
