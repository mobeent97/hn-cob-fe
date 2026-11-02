import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { RelativePipe } from '../../core/data/format';
import { ConfigProfile, DeviceTwin, TwinValue } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { simulateLoad } from '../../shared/ui/loading';
import {
  Clause, ID_RE, OPS, Op, SETTING, SETTINGS, TAG_KEYS, TagKey, fmtSetting, kebab, parseCondition, ranks,
  settingError, toCondition,
} from './config-profile-helpers';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type Status = ConfigProfile['status'];
type Tags = Record<TagKey, string>;
/** A device with an IoT Hub identity, its twin and its tags as strings (IoT Hub compares text). */
interface Target {
  id: string;
  twin: DeviceTwin | undefined;
  tags: Tags | null;
  connected: boolean;
}
interface Stat {
  targeted: number;
  applied: number;
  pending: number;
  error: number;
  /** Matches the condition but a higher-ranked active profile wins the device. */
  overridden: number;
  overriddenBy: Map<string, number>;
  /** For drafts and paused profiles: devices it would win / lose if activated now. */
  wouldWin: number;
  wouldLose: number;
  errors: Map<string, number>;
}
interface SettingRow {
  key: string;
  value: TwinValue;
}
interface Draft {
  id: string;
  idTouched: boolean;
  name: string;
  description: string;
  priority: number;
  rows: Clause[];
  advanced: boolean;
  raw: string;
  settings: SettingRow[];
}

const STATUS_TONE: Record<Status, string> = { Active: 'positive', Paused: 'warning', Draft: '' };
const TRACKER_KEYS = new Set(['reportIntervalMovingSec', 'reportIntervalStoppedSec', 'overspeedKmh', 'harshEventSensitivity', 'canBusEnabled', 'temperatureIntervalSec', 'temperatureAlarmC']);
const DASHCAM_KEYS = new Set(['videoResolution', 'eventClipSeconds', 'audioRecording']);

const blankStat = (): Stat => ({ targeted: 0, applied: 0, pending: 0, error: 0, overridden: 0, overriddenBy: new Map(), wouldWin: 0, wouldLose: 0, errors: new Map() });

/**
 * Configuration profiles — "Which settings does each part of the fleet get, and has it rolled out?"
 * Each profile is an IoT Hub automatic device configuration: a target condition on twin tags, a
 * priority and desired properties. A device gets only its highest-priority matching profile; the
 * table counts each device once, under the profile that wins it, and tracks rollout from its twin.
 */
@Component({
  selector: 'app-configprofiles',
  imports: [Select, SelectOption, ReadOnlyNote, RouterLink, Icon, Menu, Dialog, AnimatedNumber, RelativePipe, LowerCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './config-profiles.html',
  styleUrl: './config-profiles.scss',
})
export class ConfigProfiles {
  protected readonly store = inject(Store);
  /** Device management RW gates every write action on this screen. */
  protected readonly w = writeAccess('Device management');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('device-config');
  protected readonly statusTone = STATUS_TONE;
  protected readonly tagKeys = TAG_KEYS;
  protected readonly ops = OPS;
  protected readonly settingsMeta = SETTINGS;
  protected readonly meta = SETTING;
  protected readonly fmtSetting = fmtSetting;
  /** ?edit=<profile id> opens that profile's editor; ?edit=new opens a blank one. */
  readonly editParam = input<string | undefined>(undefined, { alias: 'edit' });

  constructor() {
    effect(() => {
      const id = this.editParam();
      if (!id) return;
      untracked(() => {
        const p = this.store.profiles().find((x) => x.id === id);
        if (p) this.edit(p);
        else if (id === 'new') this.add();
      });
    });
  }

  // ── Fleet as IoT Hub sees it ───────────────────────────────
  protected readonly targets = computed((): Target[] => {
    const twins = this.store.twinById();
    return this.store.iotStates().map((s) => {
      const twin = twins.get(s.deviceId);
      const t = twin?.tags as (DeviceTwin['tags'] & { useCase?: string | null }) | undefined;
      return {
        id: s.deviceId,
        twin,
        connected: s.connection === 'Connected',
        tags: t
          ? { package: t.package ?? '', deviceType: t.deviceType ?? '', customerId: t.customerId == null ? '' : String(t.customerId), country: t.country ?? '', useCase: t.useCase ?? '' }
          : null,
      };
    });
  });

  protected readonly sorted = computed(() => [...this.store.profiles()].sort(ranks));
  private readonly active = computed(() => this.sorted().filter((p) => p.status === 'Active'));
  private readonly byId = computed(() => new Map(this.store.profiles().map((p) => [p.id, p])));

  private winner(tags: Tags | null, among = this.active(), skip?: string): ConfigProfile | null {
    if (!tags) return null;
    return among.find((p) => p.id !== skip && this.store.matchesTarget(p.targetCondition, tags)) ?? null;
  }

  /** One pass over the fleet: winner per device, then rollout state of that winner. */
  protected readonly analysis = computed(() => {
    const stats = new Map(this.store.profiles().map((p) => [p.id, blankStat()]));
    const all = this.sorted();
    const noProfile: { t: Target; reason: string; why: string }[] = [];
    for (const t of this.targets()) {
      const matched = t.tags ? all.filter((p) => this.store.matchesTarget(p.targetCondition, t.tags!)) : [];
      const win = matched.find((p) => p.status === 'Active') ?? null;
      for (const p of matched) {
        const s = stats.get(p.id)!;
        if (p === win) continue;
        if (p.status === 'Active') {
          s.overridden++;
          s.overriddenBy.set(win!.id, (s.overriddenBy.get(win!.id) ?? 0) + 1);
        } else if (!win || ranks(p, win) < 0) s.wouldWin++;
        else s.wouldLose++;
      }
      if (!win) {
        noProfile.push({
          t,
          why: !t.twin ? 'No twin yet' : !t.tags?.package ? 'Not allocated: no package tag' : matched.length ? 'Only paused or draft profiles match' : 'No profile matches its tags',
          reason: !t.twin ? 'have no twin yet' : !t.tags?.package ? 'aren’t allocated, so have no package tag' : matched.length ? 'match only paused or draft profiles' : 'match no profile',
        });
        continue;
      }
      const s = stats.get(win.id)!;
      s.targeted++;
      const twin = t.twin!;
      const sync = this.store.twinSync(twin);
      if (twin.desired.props['$profile'] !== win.id) s.pending++;
      else if (sync === 'Error') {
        s.error++;
        const msg = String(twin.reported.props['$configError'] ?? 'Rejected');
        s.errors.set(msg, (s.errors.get(msg) ?? 0) + 1);
      } else if (sync === 'In sync') s.applied++;
      else s.pending++;
    }
    return { stats, noProfile };
  });

  protected stat(id: string): Stat {
    return this.analysis().stats.get(id) ?? blankStat();
  }
  protected readonly withIdentity = computed(() => this.targets().length);
  protected readonly noProfile = computed(() => this.analysis().noProfile);
  protected readonly noProfileReasons = computed(() => {
    const m = new Map<string, number>();
    for (const n of this.noProfile()) m.set(n.reason, (m.get(n.reason) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  });
  /** Sanity check the screen depends on: every device is counted once. */
  protected readonly totalsAgree = computed(
    () => this.active().reduce((a, p) => a + this.stat(p.id).targeted, 0) + this.noProfile().length === this.withIdentity(),
  );

  protected readonly totals = computed(() => {
    let targeted = 0;
    let applied = 0;
    let pending = 0;
    let error = 0;
    for (const p of this.active()) {
      const s = this.stat(p.id);
      targeted += s.targeted;
      applied += s.applied;
      pending += s.pending;
      error += s.error;
    }
    return { targeted, applied, pending, error, pct: targeted ? Math.round((applied / targeted) * 100) : 0 };
  });

  /** "6 active profiles · 94% of targeted devices in sync · Pilot … targets no devices" */
  protected readonly subline = computed(() => {
    const act = this.active();
    const t = this.totals();
    const parts = [`${act.length} active ${act.length === 1 ? 'profile' : 'profiles'}`];
    if (t.targeted) parts.push(`${t.pct}% of targeted devices in sync`);
    const newest = [...act].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (newest) {
      const s = this.stat(newest.id);
      parts.push(
        s.targeted
          ? `${newest.name} on ${s.applied} of ${s.targeted} devices`
          : s.overridden
            ? `${newest.name} is overridden on all ${s.overridden} devices it matches`
            : `${newest.name} matches no devices`,
      );
    }
    return parts.join(' · ');
  });

  protected pct(p: ConfigProfile) {
    const s = this.stat(p.id);
    return s.targeted ? (s.applied / s.targeted) * 100 : 0;
  }
  protected overriddenTitle(p: ConfigProfile) {
    const s = this.stat(p.id);
    return [...s.overriddenBy].map(([id, n]) => `${n} won by ${this.byId().get(id)?.name} (priority ${this.byId().get(id)?.priority})`).join('\n');
  }
  protected errorTitle(p: ConfigProfile) {
    return [...this.stat(p.id).errors].map(([m, n]) => `${n} × ${m}`).join('\n');
  }

  /** An example of the priority rule from the live data, for the explanation under the table. */
  protected readonly example = computed(() => {
    for (const p of this.active()) {
      const s = this.stat(p.id);
      const top = [...s.overriddenBy].sort((a, b) => b[1] - a[1])[0];
      if (top) return { loser: p, winner: this.byId().get(top[0])!, n: top[1] };
    }
    return null;
  });

  // ── Rollout: IoT Hub re-evaluates every device when a profile changes ──
  /**
   * Pushes the winning profile's desired properties to each device whose twin doesn't carry them.
   * Connected devices report back about 1.6 s later; others pick it up when they reconnect.
   */
  private reconcile(): { n: number; connected: number } {
    let n = 0;
    let connected = 0;
    for (const t of this.targets()) {
      const w = this.winner(t.tags);
      if (!w || !t.twin) continue;
      const d = t.twin.desired.props;
      const stale = d['$profile'] !== w.id || Object.entries(w.desired).some(([k, v]) => d[k] !== v);
      if (!stale) continue;
      this.store.setDesired(t.id, { ...w.desired, $profile: w.id });
      n++;
      if (t.connected) connected++;
    }
    return { n, connected };
  }

  private rolloutBody(r: { n: number; connected: number }) {
    const off = r.n - r.connected;
    return `${r.connected} connected ${r.connected === 1 ? 'device reports' : 'devices report'} back in seconds${off ? `; ${off} offline get it when they reconnect` : ''}.`;
  }

  private setStatus(p: ConfigProfile, status: Status) {
    const before = this.stat(p.id).targeted;
    this.store.saveProfile({ ...p, status, updatedAt: new Date().toISOString() });
    const r = this.reconcile();
    if (status === 'Active') {
      this.toast.show(r.n ? `Rolling out to ${r.n} ${r.n === 1 ? 'device' : 'devices'}` : `${p.name} is active`, {
        body: r.n ? this.rolloutBody(r) : 'No device needed a change.',
        action: { label: 'Undo', run: () => this.restore(p) },
      });
    } else {
      this.toast.show(`${p.name} paused`, {
        body: before
          ? `${r.n} of its ${before} devices fall back to their next profile; the rest keep their settings with no profile managing them.`
          : 'It wasn’t winning any device, so nothing changes.',
        action: { label: 'Undo', run: () => this.restore(p) },
      });
    }
  }
  private restore(p: ConfigProfile) {
    this.store.saveProfile(p);
    this.reconcile();
  }

  protected menu(p: ConfigProfile): MenuItem[] {
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(p) },
      p.status === 'Active'
        ? { label: 'Pause', icon: 'pause', run: () => this.setStatus(p, 'Paused') }
        : { label: p.status === 'Paused' ? 'Resume' : 'Activate', icon: 'play', run: () => this.setStatus(p, 'Active') },
      { label: 'Duplicate', icon: 'copy', run: () => this.duplicate(p) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.askDelete(p) },
    ];
  }

  // ── Delete ─────────────────────────────────────────────────
  protected readonly delOpen = signal(false);
  protected readonly delTarget = signal<ConfigProfile | null>(null);
  /** What happens to the devices this profile wins: who takes them over. */
  protected readonly delImpact = computed(() => {
    const p = this.delTarget();
    if (!p || p.status !== 'Active') return null;
    const next = new Map<string, number>();
    let orphaned = 0;
    for (const t of this.targets()) {
      if (this.winner(t.tags)?.id !== p.id) continue;
      const w = this.winner(t.tags, this.active(), p.id);
      if (w) next.set(w.name, (next.get(w.name) ?? 0) + 1);
      else orphaned++;
    }
    return { total: this.stat(p.id).targeted, next: [...next], orphaned };
  });
  protected askDelete(p: ConfigProfile) {
    this.delTarget.set(p);
    this.delOpen.set(true);
  }
  protected confirmDelete() {
    const p = this.delTarget();
    if (!p) return;
    this.store.deleteProfile(p.id);
    const r = this.reconcile();
    this.toast.show(`${p.name} deleted`, {
      body: r.n ? `${r.n} devices move to their next profile.` : undefined,
      action: { label: 'Undo', run: () => this.restore(p) },
    });
    this.delOpen.set(false);
  }

  // ── No-profile drawer ──────────────────────────────────────
  protected readonly gapOpen = signal(false);
  protected readonly typeOf = computed(() => {
    const types = new Map(this.store.deviceTypes().map((t) => [t.id, t.name]));
    return new Map(this.store.devices().map((d) => [d.id, types.get(d.typeId) ?? '']));
  });

  // ── Editor ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly original = signal<ConfigProfile | null>(null);
  protected readonly draft = signal<Draft>(this.blank());

  private blank(): Draft {
    return {
      id: '', idTouched: false, name: '', description: '', priority: 20,
      rows: [{ tag: 'package', op: '=', values: [] }], advanced: false, raw: '',
      settings: [{ key: 'reportIntervalMovingSec', value: 30 }, { key: 'reportIntervalStoppedSec', value: 600 }],
    };
  }
  private fromProfile(p: ConfigProfile, copy = false): Draft {
    const parsed = parseCondition(p.targetCondition);
    return {
      id: copy ? this.uniqueId(`${p.id}-copy`) : p.id,
      idTouched: copy,
      name: copy ? `${p.name} (copy)` : p.name,
      description: p.description,
      priority: p.priority,
      rows: parsed.rows,
      advanced: !!parsed.error,
      raw: p.targetCondition,
      settings: Object.entries(p.desired).map(([key, value]) => ({ key, value })),
    };
  }
  private uniqueId(base: string) {
    const ids = new Set(this.store.profiles().map((p) => p.id));
    let id = base;
    for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
    return id;
  }
  protected add() {
    this.original.set(null);
    this.draft.set(this.blank());
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(p: ConfigProfile) {
    this.original.set(p);
    this.draft.set(this.fromProfile(p));
    this.tried.set(false);
    this.open.set(true);
  }
  private duplicate(p: ConfigProfile) {
    this.original.set(null);
    this.draft.set(this.fromProfile(p, true));
    this.tried.set(false);
    this.open.set(true);
  }

  protected patch(p: Partial<Draft>) {
    this.draft.update((d) => ({ ...d, ...p }));
  }
  protected setName(name: string) {
    this.draft.update((d) => ({ ...d, name, id: this.original() || d.idTouched ? d.id : kebab(name) }));
  }
  protected setId(id: string) {
    this.patch({ id: id.toLowerCase(), idTouched: true });
  }

  // Builder rows
  protected readonly tagValues = computed(() => {
    const vals = new Map<TagKey, Set<string>>(TAG_KEYS.map((t) => [t.key, new Set<string>()]));
    for (const t of this.targets()) {
      if (!t.tags) continue;
      for (const k of TAG_KEYS) if (t.tags[k.key]) vals.get(k.key)!.add(t.tags[k.key]);
    }
    for (const p of this.store.packages()) vals.get('package')!.add(p.name);
    for (const d of this.store.deviceTypes()) vals.get('deviceType')!.add(d.name);
    const customers = new Map(this.store.customers().map((c) => [String(c.id), c.company]));
    const label = (k: TagKey, v: string) => (k === 'customerId' ? `${customers.get(v) ?? 'Customer'} · ${v}` : v);
    return new Map(
      TAG_KEYS.map((t) => [
        t.key,
        [...vals.get(t.key)!].map((v) => ({ value: v, label: label(t.key, v) })).sort((a, b) => a.label.localeCompare(b.label)),
      ]),
    );
  });
  protected valueLabel(tag: TagKey, v: string) {
    return this.tagValues().get(tag)?.find((x) => x.value === v)?.label ?? v;
  }
  private setRows(fn: (rows: Clause[]) => Clause[]) {
    this.draft.update((d) => ({ ...d, rows: fn(d.rows.map((r) => ({ ...r, values: [...r.values] }))) }));
  }
  protected addRow() {
    const used = new Set(this.draft().rows.map((r) => r.tag));
    const tag = TAG_KEYS.find((t) => !used.has(t.key))?.key ?? 'package';
    this.setRows((rows) => [...rows, { tag, op: '=', values: [] }]);
  }
  protected removeRow(i: number) {
    this.setRows((rows) => rows.filter((_, j) => j !== i));
  }
  protected setTag(i: number, tag: TagKey) {
    this.setRows((rows) => rows.map((r, j) => (j === i ? { ...r, tag, values: [] } : r)));
  }
  protected setOp(i: number, op: Op) {
    this.setRows((rows) => rows.map((r, j) => (j === i ? { ...r, op, values: op === 'in' ? r.values : r.values.slice(0, 1) } : r)));
  }
  protected setValue(i: number, v: string) {
    this.setRows((rows) => rows.map((r, j) => (j === i ? { ...r, values: v ? [v] : [] } : r)));
  }
  protected addValue(i: number, v: string, sel: Select) {
    // Reset the picker to its prompt once the value is added as a chip.
    queueMicrotask(() => sel.value.set(''));
    if (!v) return;
    this.setRows((rows) => rows.map((r, j) => (j === i && !r.values.includes(v) ? { ...r, values: [...r.values, v] } : r)));
  }
  protected removeValue(i: number, v: string) {
    this.setRows((rows) => rows.map((r, j) => (j === i ? { ...r, values: r.values.filter((x) => x !== v) } : r)));
  }
  protected toggleAdvanced() {
    const d = this.draft();
    if (!d.advanced) {
      this.patch({ advanced: true, raw: toCondition(d.rows) });
      return;
    }
    const parsed = parseCondition(d.raw);
    if (parsed.error) return; // stays in raw mode; the error is already shown
    this.patch({ advanced: false, rows: parsed.rows });
  }

  protected readonly condition = computed(() => {
    const d = this.draft();
    return d.advanced ? d.raw.trim() || '*' : toCondition(d.rows);
  });
  protected readonly conditionError = computed(() => {
    const d = this.draft();
    if (d.advanced) return parseCondition(d.raw).error;
    const empty = d.rows.findIndex((r) => !r.values.length);
    return empty >= 0 ? `Choose a value for row ${empty + 1}, or remove it.` : null;
  });

  // Settings rows
  protected freeKeys(i: number) {
    const used = new Set(this.draft().settings.filter((_, j) => j !== i).map((s) => s.key));
    return SETTINGS.filter((s) => !used.has(s.key));
  }
  protected addSetting() {
    const used = new Set(this.draft().settings.map((s) => s.key));
    const m = SETTINGS.find((s) => !used.has(s.key));
    if (m) this.patch({ settings: [...this.draft().settings, { key: m.key, value: m.default }] });
  }
  protected removeSetting(i: number) {
    this.patch({ settings: this.draft().settings.filter((_, j) => j !== i) });
  }
  protected setSettingKey(i: number, key: string) {
    this.patch({ settings: this.draft().settings.map((s, j) => (j === i ? { key, value: SETTING.get(key)!.default } : s)) });
  }
  protected setSettingValue(i: number, raw: string | boolean) {
    const key = this.draft().settings[i].key;
    const m = SETTING.get(key);
    const value: TwinValue = m?.kind === 'number' ? (raw === '' ? NaN : Number(raw)) : raw;
    this.patch({ settings: this.draft().settings.map((s, j) => (j === i ? { ...s, value } : s)) });
  }
  protected readonly firmwareOptions = computed(() => {
    const s = new Set<string>();
    for (const p of this.store.profiles()) if (p.desired['firmware']) s.add(String(p.desired['firmware']));
    return [...s].sort();
  });

  // Live preview: who would get this profile if it were active with this priority.
  protected readonly preview = computed(() => {
    const cond = this.condition();
    if (this.conditionError()) return null;
    const d = this.draft();
    const o = this.original();
    const me = { id: d.id || '~draft', priority: d.priority, createdAt: o?.createdAt ?? '9999' } as ConfigProfile;
    let matches = 0;
    let wins = 0;
    const claimedBy = new Map<string, number>();
    const takesFrom = new Map<string, number>();
    const types = new Map<string, number>();
    for (const t of this.targets()) {
      if (!t.tags || !this.store.matchesTarget(cond, t.tags)) continue;
      matches++;
      const other = this.winner(t.tags, this.active(), o?.id);
      if (!other || ranks(me, other) < 0) {
        wins++;
        types.set(t.tags.deviceType, (types.get(t.tags.deviceType) ?? 0) + 1);
        if (other) takesFrom.set(other.id, (takesFrom.get(other.id) ?? 0) + 1);
      } else claimedBy.set(other.id, (claimedBy.get(other.id) ?? 0) + 1);
    }
    const name = (id: string) => this.byId().get(id)!;
    // Settings a device category can't use: tracker settings on dashcams and the reverse.
    const cat = new Map(this.store.deviceTypes().map((x) => [x.name, x.category]));
    const keys = d.settings.map((s) => s.key);
    const trackerOnly = keys.some((k) => TRACKER_KEYS.has(k));
    const camOnly = keys.some((k) => DASHCAM_KEYS.has(k));
    const misfit = [...types].filter(([type]) => (cat.get(type) === 'Dashcam' ? trackerOnly && !camOnly : camOnly && !trackerOnly));
    return {
      matches,
      wins,
      claimedBy: [...claimedBy].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ p: name(id), n })),
      takesFrom: [...takesFrom].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ p: name(id), n })),
      types: [...types].sort((a, b) => b[1] - a[1]),
      misfit,
      everyDevice: cond === '*',
    };
  });

  protected readonly errors = computed(() => {
    const d = this.draft();
    const e: Partial<Record<'name' | 'id' | 'priority' | 'condition' | 'settings', string>> = {};
    if (!d.name.trim()) e.name = 'Name the profile.';
    if (!this.original()) {
      if (!d.id) e.id = 'Enter an ID.';
      else if (!ID_RE.test(d.id)) e.id = 'Lower-case letters, digits and single dashes.';
      else if (d.id.length > 64) e.id = 'Keep it under 64 characters.';
      else if (this.store.profiles().some((p) => p.id === d.id)) e.id = 'Another profile uses this ID.';
    }
    if (!Number.isInteger(d.priority) || d.priority < 1 || d.priority > 100) e.priority = 'A whole number from 1 to 100.';
    if (this.conditionError()) e.condition = this.conditionError()!;
    if (!d.settings.length) e.settings = 'Add at least one setting.';
    else if (d.settings.some((s) => settingError(s.key, s.value))) e.settings = 'Fix the highlighted settings.';
    return e;
  });
  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);
  protected readonly settingErr = (s: SettingRow) => settingError(s.key, s.value);
  protected readonly samePriority = computed(() => {
    const d = this.draft();
    return this.active().filter((p) => p.id !== this.original()?.id && p.priority === d.priority);
  });

  protected save(status: Status) {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const o = this.original();
    const now = new Date().toISOString();
    const p: ConfigProfile = {
      id: o?.id ?? d.id,
      name: d.name.trim(),
      description: d.description.trim(),
      targetCondition: this.condition(),
      priority: d.priority,
      desired: Object.fromEntries(d.settings.map((s) => [s.key, typeof s.value === 'string' ? s.value.trim() : s.value])),
      createdAt: o?.createdAt ?? now,
      updatedAt: now,
      createdBy: o?.createdBy ?? this.store.currentUser().name,
      status,
    };
    this.store.saveProfile(p);
    const r = this.reconcile();
    this.open.set(false);
    if (status === 'Active') {
      this.toast.show(r.n ? `Rolling out to ${r.n} ${r.n === 1 ? 'device' : 'devices'}` : `${p.name} saved`, {
        body: r.n ? this.rolloutBody(r) : 'Every device it targets already has these settings.',
        action: o ? { label: 'Undo', run: () => this.restore(o) } : undefined,
      });
    } else {
      this.toast.show(`${p.name} saved as draft`, {
        body: o?.status === 'Active' ? `It no longer applies. ${r.n} devices moved to their next profile.` : 'No device gets it until you activate it.',
      });
    }
  }
}
