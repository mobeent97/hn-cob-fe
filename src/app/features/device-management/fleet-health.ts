import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { hubHours, hubMinutes } from '../../core/data/mock-db';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DateTimePipe, fmtNum, fmtRelative } from '../../core/data/format';
import { IotTransport, TwinValue } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { DecimalPipe } from '@angular/common';
import { CountUp, SpotlightBorder } from '@iotility/shared-ui';
import { BarChart, ChartCard, ChartLegendItem, ChartTheme } from '@iotility/shared-ui';
import { BarDatum, barChart, formatNumber } from '../../shared/charts/chart-data';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { compact, hourLabel } from './iot-format';
import { ReadOnlyNote, writeAccess } from '../tenancy';

type LookKind = 'error' | 'attest' | 'offline' | 'c2d';
interface LookItem {
  key: string;
  kind: LookKind;
  deviceId: string;
  title: string;
  detail: string;
}

/** IoT Hub tiers: messages per unit per day (S1 400k, S2 6M). */
const TIERS = [
  { tier: 'S1', perUnit: 400_000 },
  { tier: 'S2', perUnit: 6_000_000 },
] as const;
const TRANSPORTS: IotTransport[] = ['MQTT (direct)', 'Gateway · Codec 8E', 'Gateway · JT/T 808'];
const DAY = 86_400_000;

/**
 * Fleet health — the screen's one question: "Is the fleet connected and reporting, and what needs a look?"
 * Biggest block: device-to-cloud messages per hour over the last 24 hours, with the hub's daily quota
 * beside it. "Messages today" has one source: Σ iotStates.messagesToday, which the generator makes
 * equal to the hourly buckets since midnight.
 */
@Component({
  selector: 'app-fleethealth',
  imports: [ReadOnlyNote, RouterLink, Icon, CountUp, SpotlightBorder, DecimalPipe, BarChart, ChartCard, Dialog, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fleet-health.html',
  styleUrl: './fleet-health.css',
})
export class FleetHealth {
  protected readonly store = inject(Store);
  /** Device management RW gates every write action on this screen. */
  protected readonly w = writeAccess('Device management');
  private readonly toaster = inject(Toaster);
  protected readonly loading = simulateLoad('fleet-health');
  protected readonly hub = this.store.hub;
  protected readonly fmtNum = fmtNum;
  protected readonly compact = compact;

  protected readonly lookAll = signal(false);
  protected readonly eventsAll = signal(false);
  protected readonly sizeOpen = signal(false);

  private readonly deviceById = computed(() => new Map(this.store.devices().map((d) => [d.id, d])));

  /** Live = sold to a customer and registered on the hub: the devices that should be reporting. */
  protected readonly live = computed(() => {
    const devs = this.deviceById();
    return this.store.iotStates().filter((s) => s.registration === 'Registered' && devs.get(s.deviceId)?.status === 'Sold');
  });
  protected readonly connected = computed(() => this.live().filter((s) => s.connection === 'Connected').length);
  protected readonly connectedPct = computed(() => pct(this.connected(), this.live().length));

  // ── Messages: one source of truth ──
  protected readonly messagesToday = computed(() => this.store.iotStates().reduce((a, s) => a + s.messagesToday, 0));
  /** Hours since local midnight (9.5 at 09:30), the same basis iot-mock uses. */
  private readonly hoursElapsed = hubHours(this.store.today) + hubMinutes(this.store.today) / 60;
  private readonly todayBuckets = Math.ceil(this.hoursElapsed);
  protected readonly projected = computed(() => Math.round((this.messagesToday() / this.hoursElapsed) * 24));
  protected readonly pace = computed(() => Math.round(this.messagesToday() / this.hoursElapsed));
  protected readonly quotaPct = computed(() => pct(this.messagesToday(), this.hub().dailyQuota));
  protected readonly projectedPct = computed(() => pct(this.projected(), this.hub().dailyQuota));

  protected readonly hourly = computed<BarDatum[]>(() => {
    const now = this.store.today;
    const partial = hubMinutes(now) > 0;
    return this.hub().messagesPerHour.map((value, i) => ({
      label: hourLabel((hubHours(now) - 23 + i + 24) % 24),
      value,
      marked: partial && i === 23,
    }));
  });
  private readonly bucketsToday = computed(() =>
    this.hub().messagesPerHour.slice(24 - this.todayBuckets).reduce((a, b) => a + b, 0),
  );
  protected readonly peak = computed(() => {
    const full = this.hourly().filter((d) => !d.marked);
    return full.reduce((a, b) => (b.value > a.value ? b : a), full[0]);
  });
  protected readonly nowLabel = hourLabel(hubHours(this.store.today));
  protected readonly nowTime = `${String(hubHours(this.store.today)).padStart(2, '0')}:${String(hubMinutes(this.store.today)).padStart(2, '0')}`;

  private readonly chartTheme = inject(ChartTheme);
  protected readonly fmtValue = formatNumber;
  protected readonly hourlyChart = computed(() => barChart(this.hourly(), 'Messages', this.chartTheme.palette()));
  protected readonly hourlyLegend = computed<ChartLegendItem[]>(() => {
    const [series] = this.hourlyChart().series;
    const partial = series.colors?.at(-1);
    return [
      { label: 'Complete hour', color: series.color! },
      ...(partial ? [{ label: `${this.nowLabel}:00–${this.nowTime}, in progress`, color: partial }] : []),
    ];
  });

  /** What each tier would need for today's projected volume. */
  protected readonly sizing = computed(() =>
    TIERS.map((t) => {
      const units = Math.max(1, Math.ceil(this.projected() / t.perUnit));
      const quota = units * t.perUnit;
      return { ...t, units, quota, usePct: pct(this.projected(), quota), current: t.tier === this.hub().tier };
    }),
  );
  protected readonly enoughNow = computed(() => this.projected() <= this.hub().dailyQuota);

  // ── Config ──
  protected readonly twinStates = computed(() => {
    const twins = this.store.twinById();
    let profiled = 0, inSync = 0, pending = 0, errors = 0;
    for (const s of this.live()) {
      const t = twins.get(s.deviceId);
      if (!t) continue;
      const sync = this.store.twinSync(t);
      if (sync === 'Not configured') continue;
      profiled++;
      if (sync === 'In sync') inSync++;
      else if (sync === 'Pending') pending++;
      else errors++;
    }
    return { profiled, inSync, pending, errors, pct: profiled ? +((inSync / profiled) * 100).toFixed(1) : 0 };
  });
  private readonly configErrors = computed(() =>
    this.store.twins().filter((t) => this.store.twinSync(t) === 'Error'),
  );

  // ── Commands, last 24 h ──
  protected readonly commands24 = computed(() => {
    const from = this.store.today.getTime() - DAY;
    return this.store.commands().filter((c) => new Date(c.sentAt).getTime() >= from);
  });
  protected readonly failed24 = computed(() => this.commands24().filter((c) => c.status === 'Failed' || c.status === 'Timed out'));
  protected readonly timedOut24 = computed(() => this.failed24().filter((c) => c.status === 'Timed out').length);

  // ── C2D ──
  protected readonly c2dDevices = computed(() =>
    this.store.iotStates().filter((s) => s.c2dQueued > 0).sort((a, b) => b.c2dQueued - a.c2dQueued),
  );
  protected readonly c2dTotal = computed(() => this.c2dDevices().reduce((a, s) => a + s.c2dQueued, 0));

  protected readonly unhealthyRoutes = computed(() => this.hub().routes.filter((r) => !r.healthy));

  // ── Needs a look ──
  protected readonly look = computed<LookItem[]>(() => {
    const devs = this.deviceById();
    const states = this.store.iotStates();
    const out: LookItem[] = [];
    const owner = (id: string) => {
      const d = devs.get(id);
      return d?.customerId ? this.store.customer(d.customerId)?.company ?? '' : d?.consumerId ? 'Consumer account' : 'In stock';
    };
    for (const t of this.configErrors()) {
      out.push({
        key: `e-${t.deviceId}`, kind: 'error', deviceId: t.deviceId,
        title: `Config error: ${String(t.reported.props['$configError'])}`,
        detail: `${t.tags.deviceType} · ${owner(t.deviceId)} · profile ${String(t.desired.props['$profile'] ?? '—')}`,
      });
    }
    for (const s of states.filter((x) => x.registration === 'Attestation failed')) {
      out.push({
        key: `a-${s.deviceId}`, kind: 'attest', deviceId: s.deviceId,
        title: 'Attestation failed: DPS rejected its credentials',
        detail: `${owner(s.deviceId)} · enrollment group ${s.enrollmentGroup} · ${s.auth}`,
      });
    }
    const cutoff = this.store.today.getTime() - DAY;
    const offline = this.live()
      .filter((s) => s.connection === 'Disconnected' && (!s.lastActivity || new Date(s.lastActivity).getTime() < cutoff))
      .sort((a, b) => (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''));
    for (const s of offline) {
      out.push({
        key: `o-${s.deviceId}`, kind: 'offline', deviceId: s.deviceId,
        title: `Offline for more than 24 h`,
        detail: `${owner(s.deviceId)} · last message ${s.lastActivity ? fmtRel(s.lastActivity) : 'never'}`,
      });
    }
    for (const s of this.c2dDevices()) {
      out.push({
        key: `c-${s.deviceId}`, kind: 'c2d', deviceId: s.deviceId,
        title: `${s.c2dQueued} C2D ${s.c2dQueued === 1 ? 'message' : 'messages'} waiting`,
        detail: `${owner(s.deviceId)} · offline since ${s.lastActivity ? fmtRel(s.lastActivity) : '—'}`,
      });
    }
    return out;
  });
  /** Capped view takes the kinds in turn, so one kind can't hide the others. */
  protected readonly lookShown = computed(() => {
    if (this.lookAll()) return this.look();
    const groups = (['error', 'attest', 'offline', 'c2d'] as LookKind[]).map((k) => this.look().filter((i) => i.kind === k));
    const out: LookItem[] = [];
    for (let r = 0; out.length < 6 && groups.some((g) => g.length > r); r++) {
      for (const g of groups) if (g[r] && out.length < 6) out.push(g[r]);
    }
    return out;
  });
  protected readonly lookCounts = computed(() => {
    const c: Record<LookKind, number> = { error: 0, attest: 0, offline: 0, c2d: 0 };
    for (const i of this.look()) c[i.kind]++;
    return c;
  });

  // ── Transport ──
  protected readonly byTransport = computed(() => {
    const rows = TRANSPORTS.map((t) => {
      const xs = this.live().filter((s) => s.transport === t);
      const conn = xs.filter((s) => s.connection === 'Connected').length;
      return { transport: t, devices: xs.length, connected: conn, pct: pct(conn, xs.length) };
    });
    return rows;
  });

  // ── Events ──
  protected readonly events = computed(() => {
    const from = this.store.today.getTime() - DAY;
    return this.store.connectionEvents().filter((e) => new Date(e.at).getTime() >= from);
  });
  protected readonly eventsShown = computed(() => (this.eventsAll() ? this.events() : this.events().slice(0, 8)));

  protected readonly finding = computed(() => {
    const parts = [
      `${fmtNum(this.connected())} of ${fmtNum(this.live().length)} live devices connected`,
      this.configErrors().length
        ? `${this.configErrors().length} config ${this.configErrors().length === 1 ? 'error' : 'errors'}`
        : null,
      ...this.unhealthyRoutes().map((r) => `route ${r.name} unhealthy`),
    ].filter(Boolean);
    return parts.join(' · ');
  });

  constructor() {
    // The figure that appears three times (KPI, chart, quota meter) must be one number.
    effect(() => {
      console.assert(
        this.bucketsToday() === this.messagesToday(),
        `Fleet health: hourly buckets since midnight (${this.bucketsToday()}) ≠ Σ messagesToday (${this.messagesToday()})`,
      );
    });
  }

  protected retryConfig(deviceId: string) {
    const t = this.store.twinById().get(deviceId);
    if (!t) return;
    const patch: Record<string, TwinValue> = {};
    for (const [k, v] of Object.entries(t.desired.props)) if (!k.startsWith('$')) patch[k] = v;
    this.store.setDesired(deviceId, patch);
    const online = this.store.iotById().get(deviceId)?.connection === 'Connected';
    this.toaster.show(`Configuration re-sent to ${deviceId}`, {
      tone: 'info',
      body: online ? 'The device should report back within a few seconds.' : 'It applies when the device reconnects.',
    });
  }
}

const pct = (n: number, of: number) => (of ? +((n / of) * 100).toFixed(1) : 0);
const fmtRel = fmtRelative;
