import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, DateTimePipe, RelativePipe, TonePipe, fmtDate } from '../../core/data/format';
import { CommandRecord, DeviceTwin, TwinValue } from '../../core/data/models';
import { Icon, IconName } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { CountUp } from '@iotility/shared-ui';
import { LineChart } from '../../shared/charts/charts';
import { simulateLoad } from '../../shared/ui/loading';
import { STATUS_LABEL } from '../inventory/device-status';
import { Access } from '../../core/access/access';
import { ReadOnlyNote } from '../tenancy';
import {
  COMMAND_DEFS, CommandDef, SettingMeta, SyncState, commandLabel, commandTone, compactPayload, finding, fmtTwin, settingMeta,
  since, syncTone, validateSetting, voltageSeries,
} from './device-meta';
import { Select, SelectOption } from '../../shared/ui/select';

type Tab = 'overview' | 'configuration' | 'commands' | 'telemetry' | 'history';
const TABS: Tab[] = ['overview', 'configuration', 'commands', 'telemetry', 'history'];
type HistoryKind = 'all' | 'lifecycle' | 'connection' | 'configuration' | 'command';
interface HistoryItem { at: string; kind: Exclude<HistoryKind, 'all'>; icon: IconName; title: string; body?: string; by?: string; tone?: 'neg' | 'pos' | 'warn' }
interface ConfigRow { key: string; meta: SettingMeta; desired: TwinValue; reported: TwinValue | undefined; status: 'In sync' | 'Pending' | 'Error' | 'Waiting'; override: boolean }

/**
 * Device — "Is this device online, configured as we asked, and doing what it should?"
 * Object header with the connection state and one finding; tabs split IoT Hub identity,
 * the twin (desired vs reported), commands, telemetry and history.
 */
@Component({
  selector: 'app-device-detail',
  imports: [Select, SelectOption, RouterLink, Icon, Tabs, Menu, Dialog, CountUp, LineChart, DatePipe, DateTimePipe, RelativePipe, TonePipe, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './device-detail.html',
  styleUrl: './device-detail.scss',
})
export class DeviceDetail {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('device-detail');
  private readonly access = inject(Access);
  /** Sending commands is an Inventory write. */
  protected readonly canCommand = computed(() => this.access.can('Inventory', 'RW'));
  /**
   * IoT Hub internals (hub name, DPS, enrollment groups, profiles, twin JSON, overrides) belong to
   * Device management, a platform-only feature. Without it the page shows plain summaries.
   */
  protected readonly hubView = computed(() => this.access.can('Device management'));
  protected readonly hubWrite = computed(() => this.access.can('Device management', 'RW'));
  protected readonly canCustomers = computed(() => this.access.can('Customers'));
  protected readonly canTracking = computed(() => this.access.can('Live tracking'));
  /** Read-only on this page: no commands and no IoT Hub changes. */
  protected readonly readOnly = computed(() => !this.canCommand() && !this.hubWrite());
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  readonly id = input<string>();
  /** ?tab=configuration etc. for deep links. */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly label = STATUS_LABEL;
  protected readonly fmtTwin = fmtTwin;
  protected readonly commandLabel = commandLabel;
  protected readonly commandTone = commandTone;
  protected readonly compactPayload = compactPayload;
  protected readonly since = since;

  // ── The record ────────────────────────────────────────────
  protected readonly device = computed(() => this.store.devices().find((d) => d.id === this.id()));
  protected readonly type = computed(() => { const d = this.device(); return d ? this.store.deviceType(d.typeId) : undefined; });
  protected readonly isDashcam = computed(() => this.type()?.category === 'Dashcam');
  protected readonly iot = computed(() => this.store.iotById().get(this.id() ?? ''));
  protected readonly twin = computed(() => this.store.twinById().get(this.id() ?? ''));
  protected readonly customer = computed(() => { const d = this.device(); return d?.customerId ? this.store.customer(d.customerId) : undefined; });
  protected readonly vehicle = computed(() => this.store.vehicles().find((v) => v.deviceId === this.id()));
  protected readonly neverConnected = computed(() => { const s = this.iot(); return !s || s.registration === 'Awaiting first connection' || s.registration === 'Attestation failed'; });
  protected readonly connected = computed(() => this.iot()?.connection === 'Connected');
  protected readonly sync = computed<SyncState>(() => { const t = this.twin(); return t ? this.store.twinSync(t) : 'Not configured'; });
  protected readonly syncTone = computed(() => (this.neverConnected() && this.sync() !== 'Not configured' ? 'info' : syncTone(this.sync())));
  protected readonly syncLabel = computed(() => (this.neverConnected() && this.sync() !== 'Not configured' ? 'Waiting' : this.sync()));
  protected readonly profile = computed(() => {
    const pid = this.twin()?.desired.props['$profile'];
    return pid ? this.store.profiles().find((p) => p.id === pid) : undefined;
  });
  protected readonly commands = computed(() => this.store.commands().filter((c) => c.deviceId === this.id()));

  protected readonly connPill = computed(() => {
    const s = this.iot();
    const hub = this.hubView();
    if (!s) return { label: hub ? 'No IoT Hub identity' : 'Not set up to connect', tone: '' };
    if (s.registration === 'Disabled') return { label: hub ? 'Disabled in IoT Hub' : 'Disabled', tone: '' };
    if (s.registration === 'Attestation failed' && !hub) return { label: 'Can’t authenticate', tone: 'negative' };
    if (s.registration === 'Attestation failed') return { label: 'Attestation failed', tone: 'negative' };
    if (s.registration === 'Awaiting first connection') return { label: 'Awaiting first connection', tone: 'info' };
    return s.connection === 'Connected'
      ? { label: `Connected · ${since(s.connectedSince)}`, tone: 'positive' }
      : { label: `Disconnected · last seen ${since(s.lastActivity)} ago`, tone: 'warning' };
  });

  protected readonly finding = computed(() => {
    const s = this.iot();
    if (!this.hubView()) {
      // Partner wording: what happens to the device, not how IoT Hub does it.
      if (!s) return 'This device isn’t set up to connect yet. HyperNym registers devices before they ship.';
      if (s.registration === 'Disabled') return 'Disabled: the device can’t connect. Ask HyperNym support to enable it again.';
      if (s.registration === 'Attestation failed') return 'The device couldn’t authenticate when it tried to connect. Contact HyperNym support.';
      if (s.registration === 'Awaiting first connection') return 'Waiting for first connection: the device gets its configuration when it first connects.';
      return finding(s, this.twin(), this.sync(), null, (iso) => fmtDate(iso).slice(0, 6))
        .replace('no configuration profile', 'no configuration set')
        .replace(/configuration v\d+/g, 'the new configuration');
    }
    if (!s) return 'This device has no IoT Hub identity yet. Register it from Provisioning.';
    return finding(s, this.twin(), this.sync(), null, (iso) => fmtDate(iso).slice(0, 6));
  });

  // ── Tabs ──────────────────────────────────────────────────
  protected readonly tab = signal<Tab>('overview');
  protected readonly tabs = computed<TabItem<Tab>[]>(() => [
    { id: 'overview', label: 'Overview' },
    { id: 'configuration', label: 'Configuration' },
    { id: 'commands', label: 'Commands', count: this.commands().length },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'history', label: 'History' },
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
    effect(() => {
      this.id();
      const t = this.tabParam() as Tab | undefined;
      untracked(() => {
        this.tab.set(t && TABS.includes(t) ? t : 'overview');
        this.editing.set(false);
        this.rawOpen.set(false);
      });
    });
    // Settings whose desired or reported value changes while the page is open get a soft text swap.
    effect(() => {
      const t = this.twin();
      untracked(() => {
        if (!t) return;
        const prev = this.prevTwin;
        this.prevTwin = t;
        if (!prev || prev.deviceId !== t.deviceId) {
          this.changedKeys.set(new Set());
          return;
        }
        const next = new Set(this.changedKeys());
        for (const k of Object.keys(t.desired.props)) {
          if (prev.desired.props[k] !== t.desired.props[k] || prev.reported.props[k] !== t.reported.props[k]) next.add(k);
        }
        if (prev.reported.props['$configError'] !== t.reported.props['$configError']) Object.keys(t.desired.props).forEach((k) => next.add(k));
        this.changedKeys.set(next);
      });
    });
  }
  private prevTwin: DeviceTwin | null = null;
  protected readonly changedKeys = signal<Set<string>>(new Set());

  // ── Overview ──────────────────────────────────────────────
  protected readonly tags = computed(() => Object.entries(this.twin()?.tags ?? {}).map(([k, v]) => `${k}=${v ?? 'null'}`));
  protected readonly recent = computed(() => this.commands().slice(0, 4));

  // ── Configuration ─────────────────────────────────────────
  protected readonly firmwareOptions = computed(() => {
    const dash = this.isDashcam();
    const all = new Set<string>();
    for (const p of this.store.profiles()) {
      const f = p.desired['firmware'];
      if (typeof f === 'string' && f.includes('Rev') !== dash) all.add(f);
    }
    const cur = this.twin()?.desired.props['firmware'];
    if (typeof cur === 'string') all.add(cur);
    return [...all].sort().reverse();
  });

  protected readonly configRows = computed<ConfigRow[]>(() => {
    const t = this.twin();
    if (!t) return [];
    const err = t.reported.props['$configError'];
    const prof = this.profile()?.desired ?? {};
    const waiting = this.neverConnected();
    return Object.entries(t.desired.props)
      .filter(([k]) => !k.startsWith('$'))
      .map(([key, desired]) => {
        const reported = t.reported.props[key];
        const status: ConfigRow['status'] = waiting ? 'Waiting' : reported === desired ? 'In sync' : err ? 'Error' : 'Pending';
        const meta = settingMeta(key, desired);
        return {
          key, desired, reported, status, override: key in prof && prof[key] !== desired,
          meta: key === 'firmware' ? { ...meta, options: this.firmwareOptions() } : meta,
        };
      });
  });
  protected readonly configError = computed(() => (this.twin()?.reported.props['$configError'] as string | undefined) ?? null);

  protected readonly editing = signal(false);
  protected readonly draft = signal<Record<string, TwinValue>>({});
  protected readonly tried = signal(false);
  protected readonly draftErrors = computed(() => {
    const e: Record<string, string> = {};
    for (const r of this.configRows()) {
      const v = this.draft()[r.key];
      if (v === undefined) continue;
      const msg = validateSetting(r.meta, v);
      if (msg) e[r.key] = msg;
    }
    return e;
  });
  protected readonly changed = computed(() => this.configRows().filter((r) => this.draft()[r.key] !== undefined && this.draft()[r.key] !== r.desired));

  protected startEdit() {
    const d: Record<string, TwinValue> = {};
    for (const r of this.configRows()) d[r.key] = r.desired;
    this.draft.set(d);
    this.tried.set(false);
    this.editing.set(true);
  }
  protected setDraft(key: string, v: TwinValue) {
    this.draft.update((d) => ({ ...d, [key]: v }));
  }
  protected num(v: string) {
    return v.trim() === '' ? NaN : Number(v);
  }
  protected saveConfig() {
    this.tried.set(true);
    if (Object.keys(this.draftErrors()).length) return;
    const ch = this.changed();
    if (!ch.length) {
      this.editing.set(false);
      return;
    }
    const id = this.id()!;
    const patch = Object.fromEntries(ch.map((r) => [r.key, this.draft()[r.key]]));
    this.store.setDesired(id, patch);
    this.editing.set(false);
    const v = this.twin()?.desired.version;
    this.toast.show(`Desired v${v} sent to ${id}`, {
      body: this.connected()
        ? `${ch.length} ${ch.length === 1 ? 'setting' : 'settings'} changed. The device reports back in a moment.`
        : 'The device is offline. IoT Hub applies it when the device reconnects.',
    });
  }

  protected readonly rawOpen = signal(false);
  protected readonly rawJson = computed(() => {
    const t = this.twin();
    if (!t) return '';
    return JSON.stringify(
      {
        deviceId: t.deviceId,
        etag: t.etag,
        tags: t.tags,
        properties: {
          desired: { ...t.desired.props, $version: t.desired.version },
          reported: { ...t.reported.props, $version: t.reported.version },
        },
      },
      null,
      2,
    );
  });

  protected async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show(`${what} copied`);
    } catch {
      this.toast.error(`Couldn’t copy ${what.toLowerCase()}`, 'The browser blocked clipboard access. Select the text and copy it instead.');
    }
  }

  // ── Telemetry ─────────────────────────────────────────────
  protected readonly reported = computed(() => this.twin()?.reported.props ?? {});
  protected readonly extV = computed(() => { const v = this.reported()['extVoltage']; return typeof v === 'number' ? v : null; });
  protected readonly voltage = computed(() => {
    const v = this.extV();
    const end = this.iot()?.lastActivity;
    return v === null || !end ? [] : voltageSeries(this.id()!, v, end);
  });
  protected readonly voltRange = computed(() => {
    const vs = this.voltage().map((p) => p.value);
    return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null;
  });
  protected readonly bars = [1, 2, 3, 4, 5];
  protected readonly signalBars = computed(() => { const v = this.reported()['gsmSignal']; return typeof v === 'number' ? v : null; });

  // ── History ───────────────────────────────────────────────
  protected readonly historyKind = signal<HistoryKind>('all');
  protected readonly history = computed<HistoryItem[]>(() => {
    const d = this.device();
    const s = this.iot();
    const t = this.twin();
    if (!d) return [];
    const out: HistoryItem[] = [];
    for (const e of this.store.deviceHistory(d)) {
      out.push({
        at: e.at, kind: 'lifecycle', by: e.by, title: this.label[e.status], body: e.note,
        icon: e.status === 'Available' ? 'package' : e.status === 'Allocated' ? 'building' : e.status === 'Sold' ? 'car' : e.status === 'Faulty' ? 'alert' : 'power',
        tone: e.status === 'Faulty' ? 'neg' : e.status === 'Sold' ? 'pos' : undefined,
      });
      if (e.status === 'Sold' && s && !this.neverConnected()) {
        out.push(this.hubView()
          ? { at: new Date(new Date(e.at).getTime() + 47 * 60000).toISOString(), kind: 'connection', icon: 'wifi', title: 'First connected through DPS', body: `Enrollment group ${s.enrollmentGroup} · ${s.transport}` }
          : { at: new Date(new Date(e.at).getTime() + 47 * 60000).toISOString(), kind: 'connection', icon: 'wifi', title: 'First connected' });
      }
    }
    for (const e of this.store.connectionEvents().filter((x) => x.deviceId === d.id)) {
      if (e.type === 'Twin changed') continue; // the desired update below covers it
      out.push({
        at: e.at, kind: e.type === 'Connected' || e.type === 'Disconnected' ? 'connection' : 'lifecycle', title: e.type, body: e.detail,
        icon: e.type === 'Connected' ? 'wifi' : e.type === 'Disconnected' ? 'wifi-off' : 'power',
        tone: e.type === 'Disconnected' ? 'warn' : undefined,
      });
    }
    if (t && Object.keys(t.desired.props).some((k) => !k.startsWith('$'))) {
      const pid = t.desired.props['$profile'];
      out.push(this.hubView()
        ? { at: t.desired.updatedAt, kind: 'configuration', icon: 'sliders', title: `Desired properties v${t.desired.version} set`, body: pid ? `Profile ${pid}` : 'Set for this device' }
        : { at: t.desired.updatedAt, kind: 'configuration', icon: 'sliders', title: 'Configuration sent to the device' });
      if (t.reported.updatedAt && !this.neverConnected()) {
        const err = t.reported.props['$configError'];
        out.push({
          at: t.reported.updatedAt, kind: 'configuration', icon: err ? 'circle-x' : 'circle-check',
          title: err ? 'Device rejected the configuration' : this.hubView() ? `Reported properties v${t.reported.version}` : 'Device reported its configuration',
          body: err ? String(err) : this.sync() === 'In sync' ? 'Matches the desired configuration' : 'Device reported its current state',
          tone: err ? 'neg' : this.sync() === 'In sync' ? 'pos' : undefined,
        });
      }
    }
    for (const c of this.commands()) {
      out.push({
        at: c.sentAt, kind: 'command', icon: c.kind === 'C2D message' ? 'send' : 'zap', by: c.sentBy,
        title: `${commandLabel(c)} · ${c.status}`, body: `${c.method}${c.response ? ' — ' + c.response : ''}`,
        tone: c.status === 'Succeeded' ? undefined : c.status === 'Failed' ? 'neg' : c.status === 'Timed out' ? 'warn' : undefined,
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  });
  protected readonly historyRows = computed(() => (this.historyKind() === 'all' ? this.history() : this.history().filter((h) => h.kind === this.historyKind())));
  protected readonly historyCounts = computed(() => {
    const m: Record<HistoryKind, number> = { all: 0, lifecycle: 0, connection: 0, configuration: 0, command: 0 };
    for (const h of this.history()) { m.all++; m[h.kind]++; }
    return m;
  });
  protected readonly historyKinds: { id: HistoryKind; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'lifecycle', label: 'Lifecycle' }, { id: 'connection', label: 'Connection' },
    { id: 'configuration', label: 'Configuration' }, { id: 'command', label: 'Commands' },
  ];

  // ── Header menu: IoT Hub registration ─────────────────────
  protected readonly menu = computed<MenuItem[]>(() => {
    const s = this.iot();
    const d = this.device();
    if (!d) return [];
    const reg: MenuItem[] = !this.hubWrite()
      ? []
      : [
          s?.registration === 'Disabled'
            ? { label: 'Enable in IoT Hub', icon: 'power', run: () => this.regOpen.set(true) }
            : { label: 'Disable in IoT Hub', icon: 'power', danger: true, disabled: !s, run: () => this.regOpen.set(true) },
        ];
    return [
      ...reg,
      { label: 'Copy device ID', icon: 'copy', run: () => this.copy(d.id, 'Device ID') },
      { label: 'View in inventory', icon: 'boxes', run: () => this.router.navigate(['/inventory'], { queryParams: { q: d.id } }) },
    ];
  });
  protected readonly regOpen = signal(false);
  protected toggleRegistration() {
    const s = this.iot();
    if (!s) return;
    const id = s.deviceId;
    if (s.registration === 'Disabled') {
      this.store.setRegistration([id], s.lastActivity ? 'Registered' : 'Awaiting first connection');
      this.toast.show(`${id} enabled in IoT Hub`, { body: 'It can connect again; it shows as connected on its next message.' });
    } else {
      const before = s.registration;
      this.store.setRegistration([id], 'Disabled');
      this.toast.show(`${id} disabled in IoT Hub`, { body: 'Its connection was closed.', action: { label: 'Undo', run: () => this.store.setRegistration([id], before) } });
    }
    this.regOpen.set(false);
  }

  // ── Send command ──────────────────────────────────────────
  protected readonly sendOpen = signal(false);
  protected readonly cmdId = signal('locate');
  protected readonly typed = signal('');
  protected readonly paramId = signal('');
  protected readonly paramValue = signal('');
  protected readonly sendTried = signal(false);
  protected readonly sentId = signal<number | null>(null);
  protected readonly sent = computed(() => (this.sentId() == null ? null : (this.store.commands().find((c) => c.id === this.sentId()) ?? null)));
  protected readonly defs = computed(() => COMMAND_DEFS.filter((c) => !this.isDashcam() || c.dashcam));
  protected readonly def = computed<CommandDef>(() => this.defs().find((c) => c.id === this.cmdId()) ?? this.defs()[0]);
  /** Typed confirmation for critical commands: the plate, or the device ID when it has no plate. */
  protected readonly confirmWord = computed(() => this.device()?.plate ?? this.id() ?? '');
  protected readonly typedOk = computed(() => {
    const n = (s: string) => s.toUpperCase().replace(/\s/g, '');
    return n(this.typed()) === n(this.confirmWord());
  });
  protected readonly paramErrors = computed(() => {
    const e: { id?: string; value?: string } = {};
    const id = this.paramId().trim();
    if (!/^\d{1,5}$/.test(id) || +id < 1 || +id > 65535) e.id = 'Enter a parameter ID, 1–65535.';
    if (!this.paramValue().trim()) e.value = 'Enter the value to write.';
    else if (this.paramValue().length > 64) e.value = 'At most 64 characters.';
    return e;
  });
  protected readonly payload = computed<Record<string, TwinValue>>(() => {
    const d = this.def();
    if (!d.param) return d.payload;
    const v = this.paramValue().trim();
    return { [this.paramId().trim() || '…']: v === '' ? '…' : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v };
  });
  protected readonly preview = computed(() => {
    const d = this.def();
    return d.kind === 'Direct method'
      ? JSON.stringify({ methodName: d.method, payload: this.payload(), responseTimeoutInSeconds: 30, connectTimeoutInSeconds: 0 })
      : JSON.stringify({ properties: { method: d.method, expiryTimeUtc: '+48h', ack: 'full' }, body: this.payload() });
  });

  protected openSend(id?: string) {
    if (id) this.cmdId.set(id);
    if (!this.defs().some((c) => c.id === this.cmdId())) this.cmdId.set(this.defs()[0].id);
    this.resetSend();
    this.sendOpen.set(true);
  }
  protected pickCmd(id: string) {
    this.cmdId.set(id);
    this.typed.set('');
    this.sendTried.set(false);
  }
  protected resetSend() {
    this.sentId.set(null);
    this.typed.set('');
    this.sendTried.set(false);
  }
  protected send() {
    const d = this.def();
    this.sendTried.set(true);
    if (d.critical && !this.typedOk()) return;
    if (d.param && Object.keys(this.paramErrors()).length) return;
    const ok = d.param ? `New value ${this.paramId().trim()}:${this.paramValue().trim()}` : d.ok;
    const rec = this.store.sendCommand(this.id()!, d.method, d.kind, this.payload(), ok);
    this.sentId.set(rec.id);
  }
  /** After a direct-method timeout: the same request as a C2D message that waits for the device. */
  protected queueInstead(c: CommandRecord) {
    const rec = this.store.sendCommand(c.deviceId, c.method, 'C2D message', c.payload, 'OK');
    this.sentId.set(rec.id);
  }
  protected readonly sending = computed(() => this.sent()?.status === 'Pending');
}
