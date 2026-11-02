import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { fmtMoney } from '../../core/data/format';
import { PackageConfig, PackageName } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type View = 'matrix' | 'packages';
type Draft = { id: number | null; name: string; description: string; monthlyPrice: number | null };

/** featureId → packages that include it. */
type Matrix = Record<number, PackageName[]>;

/**
 * Packages — "What does each package include, and what does it cost per device?"
 * The feature matrix is the biggest block: edits are staged and saved in one go, as in the legacy
 * screen, but only the cells that changed are counted and the save can be discarded.
 */
@Component({
  selector: 'app-packages',
  imports: [ReadOnlyNote, Icon, Tabs, Menu, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './packages.html',
  styleUrl: './packages.scss',
})
export class Packages {
  protected readonly store = inject(Store);
  /** Packages RW gates every write action on this screen. */
  protected readonly w = writeAccess('Packages');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('packages');
  protected readonly view = signal<View>('matrix');
  protected readonly fmtMoney = fmtMoney;

  // ── Feature matrix ─────────────────────────────────────────
  private readonly saved = computed<Matrix>(() =>
    Object.fromEntries(this.store.featureGroups().flatMap((g) => g.features.map((f) => [f.id, f.packages]))),
  );
  /** Staged edits; null means "nothing staged". */
  private readonly staged = signal<Matrix | null>(null);
  protected readonly matrix = computed(() => this.staged() ?? this.saved());

  protected readonly changes = computed(() => {
    const s = this.staged();
    if (!s) return 0;
    const saved = this.saved();
    let n = 0;
    for (const id of Object.keys(s)) {
      for (const p of this.store.packages()) {
        if (s[+id].includes(p.name) !== saved[+id].includes(p.name)) n++;
      }
    }
    return n;
  });

  protected readonly featureCount = computed(() => this.store.featureGroups().reduce((a, g) => a + g.features.length, 0));
  protected readonly perPackage = computed(() => {
    const m = this.matrix();
    return Object.fromEntries(
      this.store.packages().map((p) => [p.name, Object.values(m).filter((xs) => xs.includes(p.name)).length]),
    ) as Record<string, number>;
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => [
    { id: 'matrix', label: 'Feature matrix', count: this.featureCount() },
    { id: 'packages', label: 'Packages', count: this.store.packages().length },
  ]);

  protected has(featureId: number, p: PackageName) {
    return this.matrix()[featureId]?.includes(p) ?? false;
  }
  protected changed(featureId: number, p: PackageName) {
    return this.staged() !== null && this.has(featureId, p) !== (this.saved()[featureId]?.includes(p) ?? false);
  }

  protected toggle(featureId: number, p: PackageName, on: boolean) {
    const base = { ...this.matrix() };
    const order = this.store.packages().map((x) => x.name);
    const next = on ? [...base[featureId], p] : base[featureId].filter((x) => x !== p);
    base[featureId] = order.filter((x) => next.includes(x));
    this.staged.set(base);
  }

  protected discard() {
    this.staged.set(null);
  }

  protected saveMatrix() {
    const s = this.staged();
    if (!s) return;
    const n = this.changes();
    this.store.featureGroups.update((gs) => gs.map((g) => ({ ...g, features: g.features.map((f) => ({ ...f, packages: s[f.id] })) })));
    this.staged.set(null);
    this.toast.show('Feature matrix saved', { body: `${n} ${n === 1 ? 'change applies' : 'changes apply'} to new and existing customers.` });
  }

  // ── Packages table ─────────────────────────────────────────
  protected readonly rows = computed(() => {
    const byCustomer = this.store.devicesByCustomer();
    return this.store.packages().map((p) => {
      const customers = this.store.customers().filter((c) => c.package === p.name);
      const devices = customers.reduce((a, c) => a + (byCustomer.get(c.id)?.filter((d) => d.status === 'Sold').length ?? 0), 0);
      return { ...p, customers: customers.length, devices };
    });
  });
  protected readonly totalCustomers = computed(() => this.rows().reduce((a, r) => a + r.customers, 0));
  protected readonly totalDevices = computed(() => this.rows().reduce((a, r) => a + r.devices, 0));

  protected menu(p: PackageConfig): MenuItem[] {
    return [{ label: 'Edit', icon: 'pencil', run: () => this.edit(p) }];
  }

  protected readonly dialogOpen = signal(false);
  protected readonly draft = signal<Draft>({ id: null, name: '', description: '', monthlyPrice: null });
  protected readonly tried = signal(false);

  protected add() {
    this.draft.set({ id: null, name: '', description: '', monthlyPrice: null });
    this.tried.set(false);
    this.dialogOpen.set(true);
  }
  protected edit(p: PackageConfig) {
    this.draft.set({ id: p.id, name: p.name, description: p.description, monthlyPrice: p.monthlyPrice });
    this.tried.set(false);
    this.dialogOpen.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
  }

  protected readonly errors = computed(() => {
    const d = this.draft();
    const name = d.name.trim();
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!name) e.name = 'Enter a package name.';
    else if (name.length > 60) e.name = 'Keep the name under 60 characters.';
    else if (this.store.packages().some((p) => p.id !== d.id && p.name.toLowerCase() === name.toLowerCase())) e.name = 'A package with this name already exists.';
    if (d.monthlyPrice == null || isNaN(d.monthlyPrice)) e.monthlyPrice = 'Enter the monthly price per device.';
    else if (d.monthlyPrice <= 0 || d.monthlyPrice > 10000) e.monthlyPrice = 'Enter a price between AED 1 and AED 10,000.';
    return e;
  });

  protected savePackage() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const name = d.name.trim() as PackageName;
    if (d.id == null) {
      const id = Math.max(0, ...this.store.packages().map((p) => p.id)) + 1;
      this.store.packages.update((xs) => [...xs, { id, name, description: d.description.trim(), monthlyPrice: d.monthlyPrice! }]);
      this.toast.show(`${name} added`, { body: 'Tick its features in the matrix to define what it includes.' });
    } else {
      const old = this.store.packages().find((p) => p.id === d.id)!;
      this.store.packages.update((xs) => xs.map((p) => (p.id === d.id ? { ...p, name, description: d.description.trim(), monthlyPrice: d.monthlyPrice! } : p)));
      if (old.name !== name) {
        // Keep the matrix and customers pointing at the renamed package.
        const rename = (xs: PackageName[]) => xs.map((x) => (x === old.name ? name : x));
        this.store.featureGroups.update((gs) => gs.map((g) => ({ ...g, features: g.features.map((f) => ({ ...f, packages: rename(f.packages) })) })));
        this.store.customers.update((cs) => cs.map((c) => (c.package === old.name ? { ...c, package: name } : c)));
        this.staged.set(null);
      }
      this.toast.show(`${name} updated`);
    }
    this.dialogOpen.set(false);
  }
}
