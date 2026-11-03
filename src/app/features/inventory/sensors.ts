import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { Sensor } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';

/** snake_case, starting with has_: the flag the device reports, e.g. has_crash_detection. */
const KEY_RE = /^has_[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Sensors & features — "Which capabilities can a device type declare, and which are in use?"
 * A sensor in use by a device type can't be deleted; renaming its key carries over to those types.
 */
@Component({
  selector: 'app-sensors',
  imports: [ReadOnlyNote, Icon, Pager, Menu, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sensors.html',
  styleUrl: './sensors.css',
})
export class Sensors {
  protected readonly store = inject(Store);
  /** Device types RW gates every write action on this screen. */
  protected readonly w = writeAccess('Device types');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('sensors');

  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Sensor | null>(null);
  protected readonly name = signal('');
  protected readonly key = signal('');
  protected readonly keyTouched = signal(false);
  protected readonly submitted = signal(false);

  protected readonly confirmOpen = signal(false);
  protected readonly toDelete = signal<Sensor | null>(null);

  constructor() {
    effect(() => {
      this.q();
      this.page.set(1);
    });
  }

  /** Device types per sensor key. */
  protected readonly usedBy = computed(() => {
    const m = new Map<string, string[]>();
    for (const t of this.store.deviceTypes()) for (const k of t.sensors) (m.get(k) ?? m.set(k, []).get(k)!).push(t.name);
    return m;
  });

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.store
      .sensors()
      .map((s) => ({ ...s, types: this.usedBy().get(s.key) ?? [] }))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.key.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  protected readonly unused = computed(() => this.store.sensors().filter((s) => !this.usedBy().has(s.key)).length);

  // ── Form ────────────────────────────────────────────────
  protected readonly errors = computed(() => {
    const e: { name?: string; key?: string } = {};
    const n = this.name().trim();
    const k = this.key().trim();
    const id = this.editing()?.id;
    if (!n) e.name = 'Enter a name.';
    else if (n.length > 60) e.name = 'Keep it to 60 characters.';
    if (!k) e.key = 'Enter a key.';
    else if (!KEY_RE.test(k)) e.key = 'Use lower-case snake_case that starts with has_, e.g. has_door_sensor.';
    else if (this.store.sensors().some((s) => s.id !== id && s.key === k)) e.key = 'Another sensor uses this key.';
    return e;
  });

  /** Suggest a key from the name until the user edits the key themselves. */
  protected setName(v: string) {
    this.name.set(v);
    if (!this.keyTouched() && !this.editing()) {
      const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      this.key.set(slug ? `has_${slug}` : '');
    }
  }
  protected setKey(v: string) {
    this.keyTouched.set(true);
    this.key.set(v);
  }

  protected openAdd() {
    this.editing.set(null);
    this.name.set('');
    this.key.set('');
    this.keyTouched.set(false);
    this.submitted.set(false);
    this.formOpen.set(true);
  }
  protected openEdit(s: Sensor) {
    this.editing.set(s);
    this.name.set(s.name);
    this.key.set(s.key);
    this.keyTouched.set(true);
    this.submitted.set(false);
    this.formOpen.set(true);
  }

  protected readonly renameCount = computed(() => {
    const s = this.editing();
    return s && s.key !== this.key().trim() ? (this.usedBy().get(s.key)?.length ?? 0) : 0;
  });

  protected save() {
    this.submitted.set(true);
    if (Object.keys(this.errors()).length) return;
    const prev = this.editing();
    const next: Sensor = { id: prev?.id ?? Math.max(0, ...this.store.sensors().map((s) => s.id)) + 1, name: this.name().trim(), key: this.key().trim() };
    if (prev) {
      this.store.sensors.update((xs) => xs.map((s) => (s.id === prev.id ? next : s)));
      if (prev.key !== next.key) {
        this.store.deviceTypes.update((ts) => ts.map((t) => ({ ...t, sensors: t.sensors.map((k) => (k === prev.key ? next.key : k)) })));
      }
    } else {
      this.store.sensors.update((xs) => [...xs, next]);
    }
    this.formOpen.set(false);
    this.toast.show(prev ? `${next.name} saved` : `${next.name} added`, {
      body: prev ? undefined : 'Tick it on a device type to make it available.',
    });
  }

  protected menu(s: Sensor): MenuItem[] {
    const n = this.usedBy().get(s.key)?.length ?? 0;
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.openEdit(s) },
      {
        label: n ? `Delete (used by ${n} ${n === 1 ? 'type' : 'types'})` : 'Delete',
        icon: 'trash',
        danger: true,
        disabled: n > 0,
        run: () => {
          this.toDelete.set(s);
          this.confirmOpen.set(true);
        },
      },
    ];
  }

  protected runDelete() {
    const s = this.toDelete();
    if (!s) return;
    const before = this.store.sensors();
    this.store.sensors.update((xs) => xs.filter((x) => x.id !== s.id));
    this.confirmOpen.set(false);
    this.toast.show(`${s.name} deleted`, { action: { label: 'Undo', run: () => this.store.sensors.set(before) } });
  }

  protected export() {
    downloadCsv(
      `sensors-${new Date().toISOString().slice(0, 10)}.csv`,
      this.rows().map((s) => ({ Name: s.name, Key: s.key, 'Device types': s.types.length, 'Used by': s.types.join('; ') })),
    );
    this.toast.show('Export ready', { body: `${this.rows().length} sensors saved as CSV.`, tone: 'info' });
  }
}
