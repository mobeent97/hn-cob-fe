import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { fmtMoney } from '../../core/data/format';
import { DeviceType, PackageName } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type Draft = Omit<DeviceType, 'id' | 'warrantyYears' | 'unitPrice'> & { id: number | null; warrantyYears: string; unitPrice: string };

const PACKAGES: PackageName[] = ['Basic', 'Plug & Go', 'Advance', 'Enterprise'];
const blank = (): Draft => ({
  id: null, name: '', make: '', category: 'Gateway', packages: [], warrantyYears: '1', sensors: [], dataSheet: null, unitPrice: '',
});

/**
 * Device types — "Which hardware models can we sell, for which packages, at what price?"
 * One table, add/edit in a dialog that lists the full sensor catalogue (the legacy edit form only
 * showed sensors already attached, so new sensors could never be added to an existing type).
 */
@Component({
  selector: 'app-devicetypes',
  imports: [Select, SelectOption, Icon, Pager, Menu, Dialog, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './device-types.html',
  styleUrl: './device-types.scss',
})
export class DeviceTypes {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('device-types');
  /** Device types RW: add, edit, delete. Read-only users see the catalogue only. */
  protected readonly w = writeAccess('Device types');
  protected readonly packages = PACKAGES;
  protected readonly fmtMoney = fmtMoney;

  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  protected readonly formOpen = signal(false);
  protected readonly draft = signal<Draft>(blank());
  protected readonly submitted = signal(false);

  protected readonly confirmOpen = signal(false);
  protected readonly toDelete = signal<DeviceType | null>(null);

  constructor() {
    effect(() => {
      this.q();
      this.page.set(1);
    });
  }

  private readonly sensorName = computed(() => new Map(this.store.sensors().map((s) => [s.key, s.name])));

  /** Devices in stock or in service per type: a type with devices can't be deleted. */
  protected readonly deviceCount = computed(() => {
    const m = new Map<number, number>();
    for (const d of this.store.devices()) m.set(d.typeId, (m.get(d.typeId) ?? 0) + 1);
    return m;
  });

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const names = this.sensorName();
    return this.store
      .deviceTypes()
      .map((t) => ({ ...t, sensorNames: t.sensors.map((k) => names.get(k) ?? k), devices: this.deviceCount().get(t.id) ?? 0 }))
      .filter(
        (t) =>
          !q ||
          [t.name, t.make, t.category, t.packages.join(' '), t.sensorNames.join(' ')].some((s) => s.toLowerCase().includes(q)),
      );
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  protected readonly subline = computed(() => {
    const ts = this.store.deviceTypes();
    const gw = ts.filter((t) => t.category === 'Gateway').length;
    const noSheet = ts.filter((t) => !t.dataSheet).length;
    return `${ts.length} models · ${gw} gateways, ${ts.length - gw} dashcams` + (noSheet ? ` · ${noSheet} without a data sheet` : '');
  });

  // ── Form ────────────────────────────────────────────────
  protected readonly errors = computed(() => {
    const d = this.draft();
    const e: Partial<Record<'name' | 'make' | 'packages' | 'warranty' | 'price' | 'sensors', string>> = {};
    const name = d.name.trim();
    if (!name) e.name = 'Enter the model name.';
    else if (name.length > 60) e.name = 'Keep it to 60 characters.';
    else if (this.store.deviceTypes().some((t) => t.id !== d.id && t.name.toLowerCase() === name.toLowerCase())) e.name = 'A device type with this name exists.';
    if (!d.make.trim()) e.make = 'Enter the manufacturer.';
    if (!d.packages.length) e.packages = 'Pick at least one package.';
    const w = Number(d.warrantyYears);
    if (d.warrantyYears === '' || !Number.isInteger(w) || w < 0 || w > 10) e.warranty = 'Whole years, 0 to 10.';
    const p = Number(d.unitPrice);
    if (d.unitPrice === '' || !(p > 0)) e.price = 'Enter a price above 0.';
    if (!d.sensors.length) e.sensors = 'Tick at least one sensor or feature.';
    return e;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  protected patch(p: Partial<Draft>) {
    this.draft.update((d) => ({ ...d, ...p }));
  }
  protected toggle<K extends 'packages' | 'sensors'>(key: K, value: string, on: boolean) {
    this.draft.update((d) => {
      const list = (d[key] as string[]).filter((x) => x !== value);
      return { ...d, [key]: on ? [...list, value] : list };
    });
  }

  protected openAdd() {
    this.draft.set(blank());
    this.submitted.set(false);
    this.formOpen.set(true);
  }
  protected openEdit(t: DeviceType) {
    this.draft.set({ ...t, packages: [...t.packages], sensors: [...t.sensors], warrantyYears: String(t.warrantyYears), unitPrice: String(t.unitPrice) });
    this.submitted.set(false);
    this.formOpen.set(true);
  }

  protected save() {
    this.submitted.set(true);
    if (!this.valid()) return;
    const d = this.draft();
    const isNew = d.id == null;
    const t: DeviceType = {
      ...d,
      id: d.id ?? Math.max(0, ...this.store.deviceTypes().map((x) => x.id)) + 1,
      name: d.name.trim(),
      make: d.make.trim(),
      dataSheet: d.dataSheet?.trim() || null,
      warrantyYears: Number(d.warrantyYears),
      unitPrice: Number(d.unitPrice),
      // keep packages in catalogue order
      packages: PACKAGES.filter((p) => d.packages.includes(p)),
    };
    this.store.deviceTypes.update((xs) => (isNew ? [...xs, t] : xs.map((x) => (x.id === t.id ? t : x))));
    this.formOpen.set(false);
    this.toast.show(isNew ? `${t.name} added` : `${t.name} saved`);
  }

  // ── Row actions ─────────────────────────────────────────
  protected menu(t: DeviceType): MenuItem[] {
    const n = this.deviceCount().get(t.id) ?? 0;
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.openEdit(t) },
      {
        label: n ? `Delete (${n} devices use it)` : 'Delete',
        icon: 'trash',
        danger: true,
        disabled: n > 0,
        run: () => {
          this.toDelete.set(t);
          this.confirmOpen.set(true);
        },
      },
    ];
  }

  protected runDelete() {
    const t = this.toDelete();
    if (!t) return;
    const before = this.store.deviceTypes();
    this.store.deviceTypes.update((xs) => xs.filter((x) => x.id !== t.id));
    this.confirmOpen.set(false);
    this.toast.show(`${t.name} deleted`, { action: { label: 'Undo', run: () => this.store.deviceTypes.set(before) } });
  }

  protected export() {
    downloadCsv(
      `device-types-${new Date().toISOString().slice(0, 10)}.csv`,
      this.rows().map((t) => ({
        'Device type': t.name, Make: t.make, Category: t.category, Packages: t.packages.join('; '),
        'Warranty (years)': t.warrantyYears, Sensors: t.sensorNames.join('; '), 'Unit price (AED)': t.unitPrice,
        'Data sheet': t.dataSheet ?? '',
      })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} device types saved as CSV.`, tone: 'info' });
  }
}
