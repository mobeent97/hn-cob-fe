import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { DeviceAction } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Access } from '../../core/access/access';
import { Select, SelectOption } from '../../shared/ui/select';

type Draft = { id: number | null; name: string; endpoint: string; parameter: string; responseKey: string };
type Phase = 'choose' | 'sending' | 'done';

const ENDPOINT_RE = /^\/[a-z0-9\-_/]+$/;
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Actions that change how the vehicle drives need a typed confirmation. */
export const isCritical = (a: DeviceAction) => /immobil/i.test(a.name) || a.parameter === 'dout_1';

/**
 * Device actions — "Which commands can support send to a device, and did the device take it?"
 * Legacy fix: the old form saved empty fields to the wrong service; here the whole definition is saved,
 * and sending shows the device's acknowledgement instead of a fire-and-forget toast.
 */
@Component({
  selector: 'app-deviceactions',
  imports: [Select, SelectOption, ReadOnlyNote, Icon, Menu, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './actions.html',
  styleUrl: './actions.css',
})
export class DeviceActions {
  protected readonly store = inject(Store);
  /** Diagnostics RW gates every write action on this screen. */
  protected readonly w = writeAccess('Diagnostics');
  private readonly access = inject(Access);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('diag-actions');
  protected readonly q = signal('');
  protected readonly isCritical = isCritical;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.store.actions().filter((a) => !q || [a.name, a.endpoint, a.parameter, a.responseKey].some((x) => x.toLowerCase().includes(q)));
  });

  /** Sending a command to a device is an Inventory write; editing the catalogue is a Diagnostics write. */
  protected readonly mayCommand = computed(() => this.access.can('Inventory', 'RW'));

  protected menu(a: DeviceAction): MenuItem[] {
    const items: MenuItem[] = [];
    if (this.mayCommand()) items.push({ label: 'Send to device', icon: 'zap', run: () => this.openSend(a) });
    if (this.w.rw()) {
      items.push({ label: 'Edit', icon: 'pencil', run: () => this.edit(a) });
      items.push({ label: 'Delete', icon: 'trash', danger: true, run: () => this.remove(a) });
    }
    return items;
  }

  private remove(a: DeviceAction) {
    const before = this.store.actions();
    this.store.actions.update((xs) => xs.filter((x) => x.id !== a.id));
    this.toast.show(`${a.name} deleted`, { action: { label: 'Undo', run: () => this.store.actions.set(before) } });
  }

  // ── Add / edit ─────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>({ id: null, name: '', endpoint: '/actions/', parameter: '', responseKey: '' });

  protected add() {
    this.draft.set({ id: null, name: '', endpoint: '/actions/', parameter: '', responseKey: '' });
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(a: DeviceAction) {
    this.draft.set({ ...a });
    this.tried.set(false);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
  }

  protected readonly errors = computed(() => {
    const d = this.draft();
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.name.trim()) e.name = 'Enter the action name support will see.';
    else if (this.store.actions().some((a) => a.id !== d.id && a.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = 'An action with this name already exists.';
    if (!ENDPOINT_RE.test(d.endpoint) || d.endpoint === '/actions/') e.endpoint = 'Enter a path such as /actions/beep (lower case, no spaces).';
    else if (this.store.actions().some((a) => a.id !== d.id && a.endpoint === d.endpoint)) e.endpoint = 'Another action already posts to this endpoint.';
    if (!KEY_RE.test(d.parameter)) e.parameter = 'Use lower-case letters, digits and underscores.';
    if (!KEY_RE.test(d.responseKey)) e.responseKey = 'Use lower-case letters, digits and underscores.';
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const a: DeviceAction = { id: d.id ?? Math.max(0, ...this.store.actions().map((x) => x.id)) + 1, name: d.name.trim(), endpoint: d.endpoint, parameter: d.parameter, responseKey: d.responseKey };
    this.store.actions.update((xs) => (d.id == null ? [...xs, a] : xs.map((x) => (x.id === a.id ? a : x))));
    this.toast.show(d.id == null ? `${a.name} added` : `${a.name} updated`, { body: `POST ${a.endpoint} with ${a.parameter}` });
    this.open.set(false);
  }

  // ── Send to device ─────────────────────────────────────────
  protected readonly sendOpen = signal(false);
  protected readonly action = signal<DeviceAction | null>(null);
  protected readonly phase = signal<Phase>('choose');
  protected readonly deviceQ = signal('');
  protected readonly deviceId = signal<string | null>(null);
  protected readonly typedPlate = signal('');
  protected readonly ackAt = signal<Date | null>(null);

  protected readonly devices = computed(() => this.store.devices().filter((d) => d.status === 'Sold' && d.plate));
  protected readonly deviceOptions = computed(() => {
    const q = this.deviceQ().trim().toLowerCase().replace(/\s/g, '');
    const hits = q
      ? this.devices().filter((d) => d.id.toLowerCase().includes(q) || d.imei.includes(q) || d.plate!.toLowerCase().replace(/\s/g, '').includes(q))
      : this.devices();
    return hits.slice(0, 50);
  });
  protected readonly device = computed(() => this.store.devices().find((d) => d.id === this.deviceId()) ?? null);
  protected readonly plateOk = computed(() => {
    const d = this.device();
    const norm = (s: string) => s.toUpperCase().replace(/\s/g, '');
    return !!d?.plate && norm(this.typedPlate()) === norm(d.plate);
  });
  protected readonly canSend = computed(() => {
    const a = this.action();
    return !!a && !!this.device() && (!isCritical(a) || this.plateOk());
  });
  protected customerName(id: number | null) {
    return id ? (this.store.customer(id)?.company ?? '—') : 'Consumer';
  }

  protected openSend(a: DeviceAction) {
    this.action.set(a);
    this.phase.set('choose');
    this.typedPlate.set('');
    if (!this.deviceId()) this.deviceId.set(this.devices()[0]?.id ?? null);
    this.sendOpen.set(true);
  }
  protected pick(id: string) {
    this.deviceId.set(id || null);
    this.typedPlate.set('');
  }

  protected send() {
    if (!this.canSend()) return;
    this.phase.set('sending');
    this.timers.push(
      setTimeout(() => {
        this.ackAt.set(new Date());
        this.phase.set('done');
      }, 1400),
    );
  }
  protected again() {
    this.phase.set('choose');
    this.typedPlate.set('');
  }
  protected time(d: Date | null) {
    return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  }
  /** The value the device echoes back under the response key. */
  protected ackValue(a: DeviceAction) {
    if (a.responseKey === 'gps') return '25.2048, 55.2708';
    if (a.responseKey === 'reset') return 'ok';
    return '1';
  }
}
