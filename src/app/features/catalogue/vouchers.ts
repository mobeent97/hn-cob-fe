import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { DatePipe, NumPipe, TonePipe, daysFrom, fmtDate, fmtNum } from '../../core/data/format';
import { Voucher } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type Status = Voucher['status'];
type View = Status | 'All';
type Draft = {
  id: number | null;
  code: string;
  discountPct: number | null;
  minSpend: number | null;
  maxSpend: number | null;
  useCase: string;
  expiresAt: string;
};
type Errors = Partial<Record<keyof Draft, string>>;

const CODE_RE = /^[A-Z0-9]{4,16}$/;

/**
 * Vouchers — "Which discount codes can customers redeem right now, and which run out soon?"
 * Status is derived: a voucher past its expiry reads as Expired even if nobody updated the row.
 */
@Component({
  selector: 'app-vouchers',
  imports: [ReadOnlyNote, Icon, Tabs, Pager, Menu, Dialog, DatePipe, NumPipe, TonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vouchers.html',
  styleUrl: './vouchers.scss',
})
export class Vouchers {
  protected readonly store = inject(Store);
  /** Vouchers RW gates every write action on this screen. */
  protected readonly w = writeAccess('Vouchers');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('vouchers');
  protected readonly daysFrom = daysFrom;

  protected readonly view = signal<View>('Active');
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  constructor() {
    effect(() => {
      this.view();
      this.q();
      this.page.set(1);
    });
  }

  private readonly today = this.store.today.toISOString().slice(0, 10);

  protected status(v: Voucher): Status {
    if (v.status === 'Disabled') return 'Disabled';
    return v.expiresAt < this.today ? 'Expired' : 'Active';
  }

  private readonly searched = computed(() => {
    const q = this.q().trim().toUpperCase();
    return this.store
      .vouchers()
      .map((v) => ({ ...v, state: this.status(v) }))
      .filter((v) => !q || v.code.includes(q) || v.useCase.toUpperCase().includes(q));
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const rows = this.searched();
    const n = (s: Status) => rows.filter((v) => v.state === s).length;
    return [
      { id: 'Active', label: 'Active', count: n('Active') },
      { id: 'Expired', label: 'Expired', count: n('Expired') },
      { id: 'Disabled', label: 'Disabled', count: n('Disabled') },
      { id: 'All', label: 'All', count: rows.length },
    ];
  });

  protected readonly rows = computed(() =>
    this.searched()
      .filter((v) => this.view() === 'All' || v.state === this.view())
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) * (this.view() === 'Expired' ? -1 : 1)),
  );
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  protected readonly expiringSoon = computed(
    () => this.searched().filter((v) => v.state === 'Active' && daysFrom(v.expiresAt) <= 14).length,
  );
  protected readonly redemptions = computed(() => this.store.vouchers().reduce((a, v) => a + v.redemptions, 0));

  protected soon(v: Voucher) {
    const d = daysFrom(v.expiresAt);
    return this.status(v) === 'Active' && d >= 0 && d <= 14;
  }

  /** Partners can't change shared platform vouchers (orgId null), even with Vouchers RW. */
  protected editable(v: Voucher) {
    return this.w.rw() && (v.orgId != null || this.store.crossTenant());
  }

  protected menu(v: Voucher): MenuItem[] {
    const s = this.status(v);
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(v) },
      s === 'Disabled'
        ? { label: 'Enable', icon: 'power', disabled: v.expiresAt < this.today, run: () => this.setStatus(v, 'Active') }
        : { label: 'Disable', icon: 'power', danger: true, disabled: s === 'Expired', run: () => this.setStatus(v, 'Disabled') },
    ];
  }

  private setStatus(v: Voucher, status: Status) {
    this.store.saveVoucher({ ...v, status });
    if (status === 'Disabled') {
      this.toast.show(`${v.code} disabled`, { body: 'Customers can no longer redeem it.', action: { label: 'Undo', run: () => this.store.saveVoucher(v) } });
    } else {
      this.toast.show(`${v.code} enabled`);
    }
  }

  // ── Dialog ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>(this.blank());
  /** The voucher being edited, if it has been redeemed its terms are locked. */
  protected readonly editing = signal<Voucher | null>(null);
  protected readonly locked = computed(() => (this.editing()?.redemptions ?? 0) > 0);

  private blank(): Draft {
    const exp = new Date(this.store.today);
    exp.setDate(exp.getDate() + 60);
    return { id: null, code: '', discountPct: 10, minSpend: 1000, maxSpend: 10000, useCase: this.store.useCases()[0]?.name ?? '', expiresAt: exp.toISOString().slice(0, 10) };
  }

  protected add() {
    this.editing.set(null);
    this.draft.set(this.blank());
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(v: Voucher) {
    this.editing.set(v);
    this.draft.set({ id: v.id, code: v.code, discountPct: v.discountPct, minSpend: v.minSpend, maxSpend: v.maxSpend, useCase: v.useCase, expiresAt: v.expiresAt });
    this.tried.set(false);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
  }
  protected codeIn(e: Event) {
    this.set('code', (e.target as HTMLInputElement).value.toUpperCase().replace(/\s+/g, ''));
  }
  protected numIn(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : +v;
  }

  protected generate() {
    const words = ['FLEET', 'TRACK', 'ROUTE', 'DRIVE', 'CARGO', 'GULF'];
    const used = new Set(this.store.vouchers().map((v) => v.code));
    let code = '';
    do {
      const w = words[Math.floor(Math.random() * words.length)];
      const pct = this.draft().discountPct;
      const tail = pct && pct >= 1 && pct <= 90 ? String(pct) : '';
      const rnd = Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      code = (w + tail + rnd).slice(0, 16);
    } while (used.has(code));
    this.set('code', code);
  }

  protected readonly errors = computed<Errors>(() => {
    const d = this.draft();
    const e: Errors = {};
    if (!d.code) e.code = 'Enter a code or generate one.';
    else if (!CODE_RE.test(d.code)) e.code = 'Use 4–16 capital letters and digits, no spaces.';
    else if (this.store.vouchers().some((v) => v.id !== d.id && v.code === d.code)) e.code = 'This code is already in use.';
    if (d.discountPct == null || !Number.isInteger(d.discountPct) || d.discountPct < 1 || d.discountPct > 90) e.discountPct = 'Enter a whole number from 1 to 90.';
    if (d.minSpend == null || d.minSpend < 0) e.minSpend = 'Enter a minimum spend of AED 0 or more.';
    if (d.maxSpend == null || d.maxSpend <= 0) e.maxSpend = 'Enter a maximum spend.';
    else if (d.minSpend != null && d.minSpend >= d.maxSpend) e.maxSpend = `Must be more than the minimum spend (AED ${fmtNum(d.minSpend)}).`;
    if (!d.useCase) e.useCase = 'Choose a use case.';
    if (!d.expiresAt) e.expiresAt = 'Choose an expiry date.';
    else if (d.expiresAt <= this.today) e.expiresAt = 'Choose a date after today.';
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const prev = this.editing();
    const v: Voucher = {
      orgId: prev ? prev.orgId : this.store.crossTenant() && this.store.scopeOrgId() == null ? null : this.store.writeOrgId(),
      id: d.id ?? Math.max(0, ...this.store.vouchers.all().map((x) => x.id)) + 1,
      code: d.code,
      discountPct: d.discountPct!,
      minSpend: d.minSpend!,
      maxSpend: d.maxSpend!,
      useCase: d.useCase,
      expiresAt: d.expiresAt,
      createdAt: prev?.createdAt ?? this.store.today.toISOString(),
      redemptions: prev?.redemptions ?? 0,
      status: prev?.status === 'Disabled' ? 'Disabled' : 'Active',
    };
    this.store.saveVoucher(v);
    this.toast.show(prev ? `${v.code} updated` : `${v.code} created`, prev ? {} : { body: `${v.discountPct}% off, valid until ${fmtDate(v.expiresAt)}.` });
    if (!prev) this.view.set('Active');
    this.open.set(false);
  }
}
