import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { RelativePipe } from '../../core/data/format';
import { EnrollmentGroup, IotDeviceState, IotRegistration } from '../../core/data/models';
import { HUB_NAME } from '../../core/data/iot-mock';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { Pager, pageOf } from '../../shared/ui/pager';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { simulateLoad } from '../../shared/ui/loading';
import { DEVICE_ID_RE, parseCsv } from '../inventory/device-import';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type RegFilter = IotRegistration | 'all';
interface RegRow {
  s: IotDeviceState;
  type: string | null;
  customer: { name: string; link: (string | number)[] | null } | null;
}
interface PasteRow {
  line: number;
  id: string;
  result: 'ready' | 'new' | 'exists' | 'repeat' | 'invalid';
  note: string;
}
type TagRow = { key: string; value: string };
interface GroupDraft {
  id: string;
  type: string;
  attestation: EnrollmentGroup['attestation'];
  allocation: string;
  tags: TagRow[];
}

export const REG_TONE: Record<IotRegistration, string> = {
  Registered: 'positive',
  'Awaiting first connection': 'info',
  Disabled: '',
  'Attestation failed': 'negative',
};
const REGISTRATIONS: IotRegistration[] = ['Registered', 'Awaiting first connection', 'Disabled', 'Attestation failed'];
/** Design-phase allocation policies (DPS): one hub today, so all three resolve to it. */
export const ALLOCATIONS = [
  `Static · ${HUB_NAME} (UAE North)`,
  `Evenly weighted · ${HUB_NAME}`,
  `Lowest latency · ${HUB_NAME}`,
];
const TAG_KEYS = ['deviceType', 'package', 'customerId', 'country', 'useCase'];

/**
 * Provisioning — "Are new devices getting onto the hub?"
 * Enrollment groups (Device Provisioning Service) decide which device types may register and how;
 * the registrations list shows every device identity by state, with bulk enable / disable.
 */
@Component({
  selector: 'app-provisioning',
  imports: [ReadOnlyNote, RouterLink, Icon, Menu, Dialog, Pager, AnimatedNumber, RelativePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provisioning.html',
  styleUrl: './provisioning.scss',
})
export class Provisioning {
  protected readonly store = inject(Store);
  /** Device management RW gates every write action on this screen. */
  protected readonly w = writeAccess('Device management');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('provisioning');
  protected readonly regTone = REG_TONE;
  protected readonly registrations = REGISTRATIONS;
  protected readonly allocations = ALLOCATIONS;
  protected readonly tagKeys = TAG_KEYS;

  constructor() {
    effect(() => {
      this.filter();
      this.q();
      this.typeFilter();
      this.page.set(1);
    });
  }

  private readonly typeById = computed(() => new Map(this.store.deviceTypes().map((t) => [t.id, t])));
  private readonly deviceById = computed(() => new Map(this.store.devices().map((d) => [d.id, d])));

  // ── Enrollment groups ──────────────────────────────────────
  protected readonly groups = computed(() => {
    const enrolled = new Map<string, { all: number; waiting: number }>();
    for (const s of this.store.iotStates()) {
      const e = enrolled.get(s.enrollmentGroup) ?? { all: 0, waiting: 0 };
      e.all++;
      if (s.registration === 'Awaiting first connection') e.waiting++;
      enrolled.set(s.enrollmentGroup, e);
    }
    return this.store.enrollments().map((g) => ({
      ...g,
      type: this.typeById().get(g.deviceTypeId)?.name ?? '—',
      enrolled: enrolled.get(g.id)?.all ?? 0,
      waiting: enrolled.get(g.id)?.waiting ?? 0,
      tags: Object.entries(g.initialTwinTags),
    }));
  });
  protected readonly individual = computed(() => this.store.iotStates().filter((s) => s.enrollmentGroup === 'individual').length);
  protected readonly disabledGroups = computed(() => this.groups().filter((g) => !g.enabled));

  protected groupMenu(g: EnrollmentGroup): MenuItem[] {
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.editGroup(g) },
      g.enabled
        ? { label: 'Disable', icon: 'power', danger: true, run: () => this.askDisable(g) }
        : { label: 'Enable', icon: 'power', run: () => this.setEnabled(g, true) },
    ];
  }
  protected toggleGroup(g: EnrollmentGroup, on: boolean, el: HTMLInputElement) {
    if (on) this.setEnabled(g, true);
    else {
      el.checked = true; // stays on until confirmed
      this.askDisable(g);
    }
  }
  private setEnabled(g: EnrollmentGroup, enabled: boolean) {
    const before = this.store.enrollments().find((x) => x.id === g.id)!;
    this.store.saveEnrollment({ ...before, enabled });
    this.toast.show(`${g.id} ${enabled ? 'enabled' : 'disabled'}`, {
      body: enabled ? 'New devices of this type can register again.' : 'Devices already on the hub keep working.',
      action: { label: 'Undo', run: () => this.store.saveEnrollment(before) },
    });
  }

  protected readonly disOpen = signal(false);
  protected readonly disTarget = signal<(EnrollmentGroup & { type: string; waiting: number; enrolled: number }) | null>(null);
  protected askDisable(g: EnrollmentGroup) {
    this.disTarget.set(this.groups().find((x) => x.id === g.id) ?? null);
    this.disOpen.set(true);
  }
  protected confirmDisable() {
    const g = this.disTarget();
    if (g) this.setEnabled(g, false);
    this.disOpen.set(false);
  }

  // Group drawer
  protected readonly groupOpen = signal(false);
  protected readonly gDraft = signal<GroupDraft | null>(null);
  protected editGroup(g: EnrollmentGroup) {
    this.gDraft.set({
      id: g.id,
      type: this.typeById().get(g.deviceTypeId)?.name ?? '',
      attestation: g.attestation,
      allocation: g.allocation,
      tags: Object.entries(g.initialTwinTags).map(([key, value]) => ({ key, value })),
    });
    this.groupOpen.set(true);
  }
  protected patchG(p: Partial<GroupDraft>) {
    this.gDraft.update((d) => (d ? { ...d, ...p } : d));
  }
  protected setTag(i: number, p: Partial<TagRow>) {
    const d = this.gDraft()!;
    this.patchG({ tags: d.tags.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  }
  protected addTag() {
    const d = this.gDraft()!;
    const used = new Set(d.tags.map((t) => t.key));
    this.patchG({ tags: [...d.tags, { key: TAG_KEYS.find((k) => !used.has(k)) ?? '', value: '' }] });
  }
  protected removeTag(i: number) {
    this.patchG({ tags: this.gDraft()!.tags.filter((_, j) => j !== i) });
  }
  protected freeTagKeys(i: number) {
    const used = new Set(this.gDraft()!.tags.filter((_, j) => j !== i).map((t) => t.key));
    return TAG_KEYS.filter((k) => !used.has(k));
  }
  protected readonly gErrors = computed(() => {
    const d = this.gDraft();
    if (!d) return {} as Record<string, string>;
    const e: Record<string, string> = {};
    if (d.tags.some((t) => !t.value.trim())) e['tags'] = 'Give every tag a value, or remove it.';
    const dt = d.tags.find((t) => t.key === 'deviceType');
    if (!dt) e['type'] = 'Keep the deviceType tag: every profile targets it.';
    else if (dt.value.trim() !== d.type) e['type'] = `deviceType must be “${d.type}” for this group.`;
    return e;
  });
  protected readonly gTried = signal(false);
  protected saveGroup() {
    this.gTried.set(true);
    const d = this.gDraft();
    if (!d || Object.keys(this.gErrors()).length) return;
    const before = this.store.enrollments().find((x) => x.id === d.id)!;
    this.store.saveEnrollment({
      ...before,
      attestation: d.attestation,
      allocation: d.allocation,
      initialTwinTags: Object.fromEntries(d.tags.map((t) => [t.key, t.value.trim()])),
    });
    this.toast.show(`${d.id} saved`, {
      body: 'Applies to devices that register from now on.',
      action: { label: 'Undo', run: () => this.store.saveEnrollment(before) },
    });
    this.groupOpen.set(false);
    this.gTried.set(false);
  }

  // ── Registrations ──────────────────────────────────────────
  protected readonly filter = signal<RegFilter>('all');
  protected readonly q = signal('');
  protected readonly typeFilter = signal<string>('all');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  protected readonly typeNames = computed(() => this.store.deviceTypes().map((t) => t.name));

  protected readonly all = computed((): RegRow[] => {
    const customers = new Map(this.store.customers().map((c) => [c.id, c]));
    return this.store.iotStates().map((s) => {
      const d = this.deviceById().get(s.deviceId);
      const c = d?.customerId != null ? customers.get(d.customerId) : undefined;
      return {
        s,
        type: d ? (this.typeById().get(d.typeId)?.name ?? null) : null,
        customer: c ? { name: c.company, link: ['/customers', c.id] } : d?.consumerId != null ? { name: 'Consumer', link: null } : null,
      };
    });
  });
  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const t = this.typeFilter();
    return this.all().filter(
      (r) => (t === 'all' || r.type === t) && (!q || r.s.deviceId.toLowerCase().includes(q) || (r.customer?.name.toLowerCase().includes(q) ?? false)),
    );
  });
  protected readonly counts = computed(() => {
    const m = { all: 0, Registered: 0, 'Awaiting first connection': 0, Disabled: 0, 'Attestation failed': 0 } as Record<RegFilter, number>;
    for (const r of this.searched()) {
      m.all++;
      m[r.s.registration]++;
    }
    return m;
  });
  /** Problems first: failed attestation, then waiting, then the rest; most recent activity first. */
  protected readonly rows = computed(() => {
    const f = this.filter();
    const order = { 'Attestation failed': 0, 'Awaiting first connection': 1, Disabled: 2, Registered: 3 };
    return this.searched()
      .filter((r) => f === 'all' || r.s.registration === f)
      .sort((a, b) => order[a.s.registration] - order[b.s.registration] || (b.s.lastActivity ?? '').localeCompare(a.s.lastActivity ?? '') || a.s.deviceId.localeCompare(b.s.deviceId));
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));

  protected readonly fleet = computed(() => {
    const m = { Registered: 0, 'Awaiting first connection': 0, Disabled: 0, 'Attestation failed': 0 } as Record<IotRegistration, number>;
    for (const s of this.store.iotStates()) m[s.registration]++;
    return m;
  });
  protected readonly subline = computed(() => {
    const f = this.fleet();
    const parts = [`${f.Registered} registered`, `${f['Awaiting first connection']} awaiting first connection`];
    if (f['Attestation failed']) parts.push(`${f['Attestation failed']} failed attestation`);
    for (const g of this.disabledGroups()) parts.push(`${g.type} enrollment off${g.waiting ? `, ${g.waiting} can’t register` : ''}`);
    return parts.join(' · ');
  });

  // Selection + bulk
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  private readonly stateById = computed(() => this.store.iotById());
  protected readonly pageAllSelected = computed(() => this.pageRows().length > 0 && this.pageRows().every((r) => this.selected().has(r.s.deviceId)));
  protected readonly pageSomeSelected = computed(() => !this.pageAllSelected() && this.pageRows().some((r) => this.selected().has(r.s.deviceId)));
  protected readonly eligible = computed(() => {
    const st = [...this.selected()].map((id) => this.stateById().get(id)).filter((s): s is IotDeviceState => !!s);
    return {
      enable: st.filter((s) => s.registration === 'Disabled').length,
      disable: st.filter((s) => s.registration !== 'Disabled').length,
    };
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
      for (const r of this.pageRows()) {
        if (on) n.add(r.s.deviceId);
        else n.delete(r.s.deviceId);
      }
      return n;
    });
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }
  private restore(before: IotDeviceState[]) {
    const m = new Map(before.map((s) => [s.deviceId, s]));
    this.store.iotStates.update((xs) => xs.map((s) => m.get(s.deviceId) ?? s));
  }
  protected enable(ids = [...this.selected()]) {
    const st = ids.map((id) => this.stateById().get(id)).filter((s): s is IotDeviceState => !!s && s.registration === 'Disabled');
    if (!st.length) return;
    const before = [...st];
    // A device that has connected before is Registered again; one that never has waits for its first connection.
    this.store.setRegistration(st.filter((s) => s.lastActivity).map((s) => s.deviceId), 'Registered');
    this.store.setRegistration(st.filter((s) => !s.lastActivity).map((s) => s.deviceId), 'Awaiting first connection');
    this.toast.show(`${st.length} ${st.length === 1 ? 'device' : 'devices'} enabled`, {
      body: 'They can connect to the hub again.',
      action: { label: 'Undo', run: () => this.restore(before) },
    });
    this.clearSelection();
  }
  protected disable(ids = [...this.selected()]) {
    const st = ids.map((id) => this.stateById().get(id)).filter((s): s is IotDeviceState => !!s && s.registration !== 'Disabled');
    if (!st.length) return;
    const before = [...st];
    const live = st.filter((s) => s.connection === 'Connected').length;
    this.store.setRegistration(st.map((s) => s.deviceId), 'Disabled');
    this.toast.show(`${st.length} ${st.length === 1 ? 'device' : 'devices'} disabled`, {
      body: live ? `${live} connected ${live === 1 ? 'device was' : 'devices were'} disconnected.` : 'They can’t connect until you enable them.',
      action: { label: 'Undo', run: () => this.restore(before) },
    });
    this.clearSelection();
  }
  protected reissue(ids = [...this.selected()]) {
    const st = ids.map((id) => this.stateById().get(id)).filter((s): s is IotDeviceState => !!s);
    const x509 = st.filter((s) => s.auth === 'X.509 CA').length;
    this.toast.show(`Credentials re-issued for ${st.length} ${st.length === 1 ? 'device' : 'devices'}`, {
      tone: 'info',
      body: `${st.length - x509} symmetric-key devices get a new derived key on next connect${x509 ? `; ${x509} X.509 devices need a new certificate from the CA` : ''}. Design preview: nothing was sent.`,
    });
    this.clearSelection();
  }
  protected rowMenu(r: RegRow): MenuItem[] {
    const id = r.s.deviceId;
    return [
      r.s.registration === 'Disabled'
        ? { label: 'Enable', icon: 'power', run: () => this.enable([id]) }
        : { label: 'Disable', icon: 'power', danger: true, run: () => this.disable([id]) },
      { label: 'Re-issue credentials', icon: 'key', run: () => this.reissue([id]) },
    ];
  }
  protected clearFilters() {
    this.filter.set('all');
    this.q.set('');
    this.typeFilter.set('all');
  }

  // ── Register devices dialog ────────────────────────────────
  protected readonly regOpen = signal(false);
  protected readonly regText = signal('');
  protected readonly regFile = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected openRegister() {
    this.regText.set('');
    this.regFile.set(null);
    this.regOpen.set(true);
  }
  /** Device IDs from pasted text or a CSV: a device_id column if there's a header, else every token. */
  protected readonly parsed = computed((): PasteRow[] => {
    const text = this.regText().replace(/^﻿/, '');
    if (!text.trim()) return [];
    let ids: { line: number; id: string }[];
    const table = parseCsv(text);
    const head = table[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = head.indexOf('device_id');
    if (col >= 0) ids = table.slice(1).map((r, i) => ({ line: i + 2, id: (r[col] ?? '').trim() }));
    else
      ids = text
        .split(/\r?\n/)
        .flatMap((l, i) => l.split(/[\s,;]+/).filter(Boolean).map((id) => ({ line: i + 1, id })));
    const have = this.store.iotById();
    const seen = new Set<string>();
    return ids.map(({ line, id: raw }) => {
      const id = raw.toUpperCase();
      const d = this.deviceById().get(id);
      let result: PasteRow['result'];
      let note: string;
      if (!DEVICE_ID_RE.test(id)) [result, note] = ['invalid', 'Not a device ID: 3–20 letters, digits or dashes'];
      else if (seen.has(id)) [result, note] = ['repeat', 'Repeated in this list'];
      else if (have.has(id)) [result, note] = ['exists', `Already on the hub · ${have.get(id)!.registration}`];
      else if (d) [result, note] = ['ready', `In Inventory · ${this.typeById().get(d.typeId)?.name ?? ''}`];
      else [result, note] = ['new', 'Not in Inventory: registers as an individual enrollment with no tags'];
      seen.add(id);
      return { line, id, result, note };
    });
  });
  protected readonly toRegister = computed(() => this.parsed().filter((r) => r.result === 'ready' || r.result === 'new'));
  protected readonly skipped = computed(() => this.parsed().length - this.toRegister().length);
  protected onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files[0];
    if (f) this.read(f);
  }
  protected onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.read(f);
  }
  private read(f: File) {
    if (f.size > 2 * 1024 * 1024) {
      this.toast.error('File too large', 'Keep it under 2 MB.');
      return;
    }
    f.text().then((t) => {
      this.regFile.set(f.name);
      this.regText.set(t);
    });
  }
  protected register() {
    const ids = this.toRegister().map((r) => r.id);
    if (!ids.length) return;
    this.store.registerDevices(ids);
    const fresh = this.toRegister().filter((r) => r.result === 'new').length;
    this.toast.show(`${ids.length} ${ids.length === 1 ? 'device' : 'devices'} registered`, {
      body: `They show as Awaiting first connection until they connect.${fresh ? ` ${fresh} aren’t in Inventory yet.` : ''}`,
      action: { label: 'Show', run: () => this.filter.set('Awaiting first connection') },
    });
    this.regOpen.set(false);
  }
}
