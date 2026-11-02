import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { DiagnosticParam } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { Reading, sampleReadings } from './readings';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type Draft = { id: number | null; parameter: string; responseKey: string; typeIds: number[] };
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Diagnostic parameters — "Which values can support read from a device, and under which key?"
 * Each parameter maps a readable name to the key in the device's telemetry payload, per device type
 * (the legacy screen never saved the device-type link; here it is part of the definition).
 */
@Component({
  selector: 'app-parameters',
  imports: [ReadOnlyNote, Icon, Menu, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './parameters.html',
  styleUrl: './parameters.scss',
})
export class Parameters {
  protected readonly store = inject(Store);
  /** Diagnostics RW gates every write action on this screen. */
  protected readonly w = writeAccess('Diagnostics');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('diag-params');
  protected readonly q = signal('');

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.store
      .params()
      .filter((p) => !q || p.parameter.toLowerCase().includes(q) || p.responseKey.toLowerCase().includes(q))
      .map((p) => ({ ...p, types: p.typeIds.map((id) => this.store.deviceTypes().find((t) => t.id === id)?.name).filter(Boolean) as string[] }));
  });

  protected typesLabel(types: string[]) {
    return types.length <= 3 ? types.join(', ') : `${types.slice(0, 3).join(', ')} +${types.length - 3}`;
  }

  protected menu(p: DiagnosticParam): MenuItem[] {
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(p) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.remove(p) },
    ];
  }

  private remove(p: DiagnosticParam) {
    const before = this.store.params();
    this.store.params.update((xs) => xs.filter((x) => x.id !== p.id));
    this.toast.show(`${p.parameter} deleted`, { action: { label: 'Undo', run: () => this.store.params.set(before) } });
  }

  // ── Add / edit ─────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>({ id: null, parameter: '', responseKey: '', typeIds: [] });

  protected add() {
    this.draft.set({ id: null, parameter: '', responseKey: '', typeIds: [] });
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(p: DiagnosticParam) {
    this.draft.set({ id: p.id, parameter: p.parameter, responseKey: p.responseKey, typeIds: [...p.typeIds] });
    this.tried.set(false);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
  }
  protected toggleType(id: number, on: boolean) {
    this.draft.update((d) => ({ ...d, typeIds: this.store.deviceTypes().map((t) => t.id).filter((x) => (x === id ? on : d.typeIds.includes(x))) }));
  }

  protected readonly errors = computed(() => {
    const d = this.draft();
    const e: { parameter?: string; responseKey?: string; typeIds?: string } = {};
    if (!d.parameter.trim()) e.parameter = 'Enter a parameter name.';
    else if (d.parameter.trim().length > 60) e.parameter = 'Keep the name under 60 characters.';
    if (!d.responseKey) e.responseKey = 'Enter the key the device reports this value under.';
    else if (!KEY_RE.test(d.responseKey)) e.responseKey = 'Use lower-case letters, digits and underscores, starting with a letter.';
    else if (this.store.params().some((p) => p.id !== d.id && p.responseKey === d.responseKey)) e.responseKey = 'Another parameter already reads this key.';
    if (!d.typeIds.length) e.typeIds = 'Choose at least one device type.';
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const p: DiagnosticParam = { id: d.id ?? Math.max(0, ...this.store.params().map((x) => x.id)) + 1, parameter: d.parameter.trim(), responseKey: d.responseKey, typeIds: d.typeIds };
    this.store.params.update((xs) => (d.id == null ? [...xs, p] : xs.map((x) => (x.id === p.id ? p : x))));
    this.toast.show(d.id == null ? `${p.parameter} added` : `${p.parameter} updated`);
    this.open.set(false);
  }

  // ── Test on a device ───────────────────────────────────────
  protected readonly testOpen = signal(false);
  protected readonly deviceQ = signal('');
  protected readonly deviceId = signal<string | null>(null);
  protected readonly refreshN = signal(0);
  protected readonly reading = signal(false);
  protected readonly readAt = signal<number>(Date.now());
  private readonly now = signal(Date.now());

  protected readonly soldDevices = computed(() =>
    this.store.devices().filter((d) => d.status === 'Sold' && this.store.params().some((p) => p.typeIds.includes(d.typeId))),
  );
  protected readonly deviceOptions = computed(() => {
    const q = this.deviceQ().trim().toLowerCase().replace(/\s/g, '');
    const all = this.soldDevices();
    const hits = q
      ? all.filter((d) => d.id.toLowerCase().includes(q) || d.imei.includes(q) || (d.plate ?? '').toLowerCase().replace(/\s/g, '').includes(q))
      : all;
    return hits.slice(0, 50);
  });
  protected readonly device = computed(() => this.store.devices().find((d) => d.id === this.deviceId()) ?? null);
  protected readonly readings = computed<Reading[]>(() => {
    const d = this.device();
    if (!d) return [];
    return sampleReadings(d, this.store.params().filter((p) => p.typeIds.includes(d.typeId)), this.refreshN());
  });
  protected readonly freshness = computed(() => {
    const s = Math.max(0, Math.round((this.now() - this.readAt()) / 1000));
    return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
  });
  protected customerName(id: number | null) {
    return id ? (this.store.customer(id)?.company ?? '—') : 'Consumer';
  }

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 5000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  protected openTest() {
    if (!this.deviceId()) this.deviceId.set(this.soldDevices()[0]?.id ?? null);
    this.read();
    this.testOpen.set(true);
  }
  protected pick(id: string) {
    this.deviceId.set(id || null);
    this.read();
  }
  protected read() {
    this.reading.set(true);
    setTimeout(() => {
      this.refreshN.update((n) => n + 1);
      this.readAt.set(Date.now());
      this.now.set(Date.now());
      this.reading.set(false);
    }, 600);
  }
}
