import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, TonePipe, daysFrom, fmtMoney, fmtRelative } from '../../core/data/format';
import { HardwareOrder, OrderStatus } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { Access } from '../../core/access/access';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';
import { simulateLoad } from '../../shared/ui/loading';

type View = OrderStatus | 'all';
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { Placed: 'Packed', Packed: 'Shipped', Shipped: 'Delivered' };
const COURIERS = ['Aramex', 'DHL Express', 'Q-Post', 'FedEx', 'SMSA Express'];
const toInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/**
 * Hardware orders — "Which orders do I need to pack or ship next?"
 * Tabs split by status; one kebab per row moves an order one step on. Shipping asks for the
 * courier and an optional ETA (legacy: courier was read-only, an empty ETA was sent as
 * "undefined-undefined-undefined").
 */
@Component({
  selector: 'app-orders',
  imports: [RouterLink, Icon, Tabs, Pager, Menu, Dialog, DatePipe, TonePipe, OrgTag, OrgFilter, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders.html',
  styleUrl: './orders.css',
})
export class Orders {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('orders');
  protected readonly accessSvc = inject(Access);
  protected readonly access = writeAccess('Hardware orders');
  protected readonly canCustomers = computed(() => this.accessSvc.can('Customers'));
  protected readonly orgs = orgContext();
  protected readonly orgId = signal<number | null>(null);
  protected readonly couriers = COURIERS;
  protected readonly fmtMoney = fmtMoney;
  protected readonly daysFrom = daysFrom;
  protected readonly todayInput = toInputDate(this.store.today.toISOString());

  protected readonly view = signal<View>('Placed');
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  // Ship dialog
  protected readonly shipOpen = signal(false);
  protected readonly shipping = signal<HardwareOrder | null>(null);
  protected readonly courier = signal('');
  protected readonly eta = signal('');
  protected readonly shipSubmitted = signal(false);

  // Cancel confirm
  protected readonly cancelOpen = signal(false);
  protected readonly cancelling = signal<HardwareOrder | null>(null);

  constructor() {
    effect(() => {
      this.view();
      this.q();
      this.orgId();
      this.page.set(1);
    });
  }

  private readonly enriched = computed(() =>
    this.store
      .orders()
      .map((o) => {
        const t = this.store.deviceType(o.typeId);
        return { ...o, type: t, customer: this.store.customer(o.customerId), amount: o.quantity * (t?.unitPrice ?? 0) };
      })
      .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)),
  );

  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const org = this.orgs.showOrg() ? this.orgId() : null;
    return this.enriched().filter(
      (o) =>
        (org == null || o.orgId === org) &&
        (!q ||
        o.orderNo.toLowerCase().includes(q) ||
        (o.customer?.company.toLowerCase().includes(q) ?? false) ||
        o.orderedBy.toLowerCase().includes(q) ||
        (o.type?.name.toLowerCase().includes(q) ?? false)),
    );
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const rows = this.searched();
    const n = (s: OrderStatus) => rows.filter((o) => o.status === s).length;
    return [
      ...(['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'] as OrderStatus[]).map((s) => ({ id: s, label: s, count: n(s) })),
      { id: 'all' as View, label: 'All', count: rows.length },
    ];
  });

  protected readonly rows = computed(() => this.searched().filter((o) => this.view() === 'all' || o.status === this.view()));
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  /** The finding: how many still need to go out, and how long the oldest has waited. */
  protected readonly finding = computed(() => {
    const open = this.store.orders().filter((o) => o.status === 'Placed' || o.status === 'Packed');
    if (!open.length) return 'Nothing waiting to ship';
    const oldest = open.reduce((a, b) => (a.orderedAt < b.orderedAt ? a : b));
    return `${open.length} ${open.length === 1 ? 'order' : 'orders'} to ship, oldest placed ${this.age(oldest.orderedAt)}`;
  });
  private age(iso: string) {
    const d = -daysFrom(iso);
    return d < 1 ? fmtRelative(iso) : `${d} d ago`;
  }
  protected readonly inTransit = computed(() => this.store.orders().filter((o) => o.status === 'Shipped').length);

  // ── Actions ─────────────────────────────────────────────
  protected menu(o: HardwareOrder): MenuItem[] {
    const next = NEXT[o.status];
    const items: MenuItem[] = [];
    const view: MenuItem = { label: 'View customer', icon: 'building-2', run: () => this.router.navigate(['/customers', o.customerId]) };
    if (!this.access.rw()) return this.canCustomers() ? [view] : [];
    if (next === 'Shipped') items.push({ label: 'Mark shipped…', icon: 'truck', run: () => this.openShip(o) });
    else if (next) items.push({ label: `Mark ${next.toLowerCase()}`, icon: next === 'Delivered' ? 'circle-check' : 'package', run: () => this.advance(o, next) });
    if (o.status === 'Shipped') items.push({ label: 'Edit courier and ETA', icon: 'pencil', run: () => this.openShip(o) });
    if (this.canCustomers()) items.push(view);
    if (o.status === 'Placed' || o.status === 'Packed') {
      items.push({ label: 'Cancel order', icon: 'x', danger: true, run: () => this.askCancel(o) });
    }
    return items;
  }

  private restore(prev: HardwareOrder) {
    this.store.orders.update((xs) => xs.map((x) => (x.id === prev.id ? prev : x)));
  }

  protected advance(o: HardwareOrder, to: OrderStatus) {
    this.store.setOrderStatus(o.id, to);
    if (to === 'Delivered') this.store.orders.update((xs) => xs.map((x) => (x.id === o.id ? { ...x, eta: null } : x)));
    this.toast.show(`${o.orderNo} marked ${to.toLowerCase()}`, { action: { label: 'Undo', run: () => this.restore(o) } });
  }

  protected openShip(o: HardwareOrder) {
    this.shipping.set(o);
    this.courier.set(o.courier ?? '');
    this.eta.set(toInputDate(o.eta));
    this.shipSubmitted.set(false);
    this.shipOpen.set(true);
  }

  protected readonly shipErrors = computed(() => {
    const e: { courier?: string; eta?: string } = {};
    if (!this.courier().trim()) e.courier = 'Enter the courier.';
    if (this.eta() && this.eta() < this.todayInput) e.eta = 'The ETA can’t be in the past.';
    return e;
  });

  protected ship() {
    this.shipSubmitted.set(true);
    const o = this.shipping();
    if (!o || Object.keys(this.shipErrors()).length) return;
    const courier = this.courier().trim();
    // An empty ETA is stored as null and shown as "—".
    const eta = this.eta() ? new Date(`${this.eta()}T12:00:00+04:00`).toISOString() : null;
    const wasShipped = o.status === 'Shipped';
    this.store.orders.update((xs) => xs.map((x) => (x.id === o.id ? { ...x, status: 'Shipped', courier, eta } : x)));
    this.shipOpen.set(false);
    this.toast.show(wasShipped ? `${o.orderNo} updated` : `${o.orderNo} shipped`, {
      body: `${courier}${eta ? ` · ETA ${this.fmtEta(eta)}` : ' · no ETA yet'}`,
      action: { label: 'Undo', run: () => this.restore(o) },
    });
  }
  private fmtEta(iso: string) {
    return new DatePipe().transform(iso);
  }

  protected askCancel(o: HardwareOrder) {
    this.cancelling.set(o);
    this.cancelOpen.set(true);
  }
  protected runCancel() {
    const o = this.cancelling();
    if (!o) return;
    this.store.orders.update((xs) => xs.map((x) => (x.id === o.id ? { ...x, status: 'Cancelled', eta: null } : x)));
    this.cancelOpen.set(false);
    this.toast.show(`${o.orderNo} cancelled`, { action: { label: 'Undo', run: () => this.restore(o) } });
  }
  protected readonly cancelSummary = computed(() => {
    const o = this.cancelling();
    if (!o) return '';
    const t = this.store.deviceType(o.typeId);
    return `${o.quantity} × ${t?.name ?? 'device'} for ${this.store.customer(o.customerId)?.company ?? 'this customer'}`;
  });

  protected export() {
    downloadCsv(
      `hardware-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      this.rows().map((o) => ({
        'Order no': o.orderNo,
        ...(this.orgs.showOrg() ? { Organization: this.orgs.name(o.orgId) } : {}),
        Customer: o.customer?.company ?? '', 'Device type': o.type?.name ?? '', Quantity: o.quantity,
        'Amount (AED)': o.amount, 'Ordered by': o.orderedBy, 'Ordered at': o.orderedAt, ETA: o.eta ?? '', Courier: o.courier ?? '',
        Status: o.status, 'Delivery address': o.address, Phone: o.phone,
      })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} orders saved as CSV.`, tone: 'info' });
  }
}
