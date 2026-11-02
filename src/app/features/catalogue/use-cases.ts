import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { PackageName, UseCase } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type Draft = { id: number | null; name: string; packages: PackageName[]; modules: string[] };

/**
 * Use cases — "Which packages and modules does each use case sell, and who is on it?"
 * Legacy fix: removing a module in the dialog is staged, and only applies when the use case is saved
 * (the old form deleted it on the server immediately, even for modules never saved).
 */
@Component({
  selector: 'app-usecases',
  imports: [ReadOnlyNote, Icon, Menu, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './use-cases.html',
  styleUrl: './use-cases.scss',
})
export class UseCases {
  protected readonly store = inject(Store);
  /** Use cases RW gates every write action on this screen. */
  protected readonly w = writeAccess('Use cases');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('use-cases');

  protected readonly allModules = computed(() => this.store.featureGroups().map((g) => g.name));
  private readonly featuresIn = computed(() => new Map(this.store.featureGroups().map((g) => [g.name, g.features.length])));

  protected readonly rows = computed(() =>
    this.store.useCases().map((u) => ({
      ...u,
      customers: this.store.customers().filter((c) => c.useCase === u.name).length,
      features: u.modules.reduce((a, m) => a + (this.featuresIn().get(m) ?? 0), 0),
    })),
  );
  protected readonly inUse = computed(() => this.rows().reduce((a, r) => a + r.customers, 0));

  protected menu(u: UseCase & { customers: number }): MenuItem[] {
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(u) },
      { label: u.customers ? `Delete (${u.customers} customers on it)` : 'Delete', icon: 'trash', danger: true, disabled: u.customers > 0, run: () => this.askDelete(u) },
    ];
  }

  // ── Dialog ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>({ id: null, name: '', packages: [], modules: [] });
  /** The use case as it was when the dialog opened, to show what Save will remove. */
  private readonly original = signal<UseCase | null>(null);

  protected add() {
    this.original.set(null);
    this.draft.set({ id: null, name: '', packages: [], modules: [] });
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(u: UseCase) {
    this.original.set(u);
    this.draft.set({ id: u.id, name: u.name, packages: [...u.packages], modules: [...u.modules] });
    this.tried.set(false);
    this.open.set(true);
  }

  protected setName(v: string) {
    this.draft.update((d) => ({ ...d, name: v }));
  }
  protected togglePkg(p: PackageName, on: boolean) {
    const order = this.store.packages().map((x) => x.name);
    this.draft.update((d) => ({ ...d, packages: order.filter((x) => (x === p ? on : d.packages.includes(x))) }));
  }
  protected toggleModule(m: string, on: boolean) {
    const order = this.allModules();
    this.draft.update((d) => ({ ...d, modules: order.filter((x) => (x === m ? on : d.modules.includes(x))) }));
  }

  /** Modules that were saved on the use case and are unticked in the draft. */
  protected readonly removedModules = computed(() => {
    const o = this.original();
    return o ? o.modules.filter((m) => !this.draft().modules.includes(m)) : [];
  });
  protected readonly affectedCustomers = computed(() => {
    const o = this.original();
    return o ? this.store.customers().filter((c) => c.useCase === o.name).length : 0;
  });

  protected readonly errors = computed(() => {
    const d = this.draft();
    const name = d.name.trim();
    const e: { name?: string; packages?: string; modules?: string } = {};
    if (!name) e.name = 'Enter a use case name.';
    else if (name.length > 60) e.name = 'Keep the name under 60 characters.';
    else if (this.store.useCases().some((u) => u.id !== d.id && u.name.toLowerCase() === name.toLowerCase())) e.name = 'A use case with this name already exists.';
    if (!d.packages.length) e.packages = 'Choose at least one package.';
    if (!d.modules.length) e.modules = 'Choose at least one module.';
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const name = d.name.trim();
    if (d.id == null) {
      const id = Math.max(0, ...this.store.useCases().map((u) => u.id)) + 1;
      this.store.useCases.update((xs) => [...xs, { id, name, packages: d.packages, modules: d.modules }]);
      this.toast.show(`${name} added`);
    } else {
      const old = this.original()!;
      this.store.useCases.update((xs) => xs.map((u) => (u.id === d.id ? { ...u, name, packages: d.packages, modules: d.modules } : u)));
      if (old.name !== name) {
        this.store.customers.update((cs) => cs.map((c) => (c.useCase === old.name ? { ...c, useCase: name } : c)));
        this.store.vouchers.update((vs) => vs.map((v) => (v.useCase === old.name ? { ...v, useCase: name } : v)));
      }
      const removed = this.removedModules().length;
      this.toast.show(`${name} saved`, removed ? { body: `${removed} ${removed === 1 ? 'module' : 'modules'} removed.` } : {});
    }
    this.open.set(false);
  }

  // ── Delete ─────────────────────────────────────────────────
  protected readonly confirmOpen = signal(false);
  protected readonly toDelete = signal<UseCase | null>(null);
  private askDelete(u: UseCase) {
    this.toDelete.set(u);
    this.confirmOpen.set(true);
  }
  protected runDelete() {
    const u = this.toDelete();
    if (!u) return;
    this.store.useCases.update((xs) => xs.filter((x) => x.id !== u.id));
    this.confirmOpen.set(false);
    this.toast.show(`${u.name} deleted`, { action: { label: 'Undo', run: () => this.store.useCases.update((xs) => [...xs, u].sort((a, b) => a.id - b.id)) } });
  }
}
