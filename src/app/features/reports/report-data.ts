import { Store } from '../../core/data/store';
import { MONTHS, fmtDate, fmtMoney, fmtNum } from '../../core/data/format';
import { Customer, Device, ONBOARDING_STEPS, PackageName } from '../../core/data/models';
import { BarDatum, LinePoint, RingSegment } from '../../shared/charts/chart-data';
import type { IconName } from '../../shared/ui/icon';

/*
 * Report definitions. Every figure is computed from the Store's rows for the chosen filters.
 * Where a date the API will record isn't in the sample data yet, it is modelled deterministically
 * from the row's own dates (and stated in the report's footnote):
 *   device received = createdAt, allocated = +2 days, activated = +6 days, faulty = +9 days
 *   (the same lifecycle Store.deviceHistory() shows on the device page).
 */

export type RangeKey = '30d' | 'quarter' | '12m' | 'ytd';
export const PACKAGES: PackageName[] = ['Basic', 'Plug & Go', 'Advance', 'Enterprise'];

export interface Filters {
  range: RangeKey;
  country: string; // 'all' | ISO code
  pkg: PackageName | 'all';
}
export const DEFAULT_FILTERS: Filters = { range: '12m', country: 'all', pkg: 'all' };

export interface Period {
  from: Date;
  to: Date;
  /** "the last 30 days", "Q3 2026" — used inside sentences. */
  label: string;
}

export interface Bucket {
  from: Date;
  to: Date;
  label: string;
  /** The current, incomplete month. */
  marked: boolean;
}

/** delta: a pre-signed string ("+8") set right-aligned like the numbers around it. */
export type Fmt = 'n' | 'money' | 'pct' | 'days' | 'text' | 'date' | 'delta';

export interface Kpi {
  label: string;
  /** Icon in the card's chip. */
  icon?: IconName;
  /** Colour carries meaning: a tone for a status or severity, neutral (the default) for plain counts. */
  tone?: 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  value: number | null;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Signed change against the named baseline; coloured by whether the direction is good. */
  change?: { n: number; prev: number; better: 'up' | 'down'; fmt?: 'n' | 'money' | 'pct' | 'days'; vs: string };
  caption?: string;
}

export interface Col {
  key: string;
  label: string;
  fmt?: Fmt;
  /** The row's key figure: stays beside the name on a phone. */
  keep?: boolean;
}
export type Row = Record<string, string | number | null> & { _link?: string };
export interface Table {
  id: string;
  label: string;
  sub: string;
  noun: string;
  cols: Col[];
  rows: Row[];
  total?: Row;
}

export type Chart =
  | { kind: 'bars'; data: BarDatum[]; legend?: [string, string] }
  | { kind: 'lines'; data: LinePoint[]; compare: LinePoint[]; legend: [string, string] }
  | { kind: 'hbars'; rows: { label: string; value: number; pct: number; display: string; sub?: string }[] }
  | {
      kind: 'ring';
      segments: RingSegment[];
      head: string[];
      legend: { label: string; colour: string; cells: string[] }[];
    };

export interface ReportResult {
  /** One finding for the subline, built from the same figures as the KPIs. */
  finding: string;
  /** The figure shown on the reports list, and the window it covers. */
  headline: string;
  headlineSub: string;
  kpis: Kpi[];
  chartTitle: string;
  chartSub: string;
  chart: Chart;
  tables: Table[];
  empty: boolean;
  emptyText: string;
  footnote?: string;
}

export interface ReportDef {
  id: string;
  area: 'Onboarding' | 'Fleet & devices' | 'Commercial';
  name: string;
  question: string;
  /** Looks ahead from today instead of back (renewals). */
  forward?: boolean;
  compute(ctx: Ctx): ReportResult;
}

export interface Ctx {
  store: Store;
  f: Filters;
  today: Date;
  period: Period;
  prev: Period;
  buckets: Bucket[];
  /** "vs previous 30 days" */
  vs: string;
  customerOk: (c: Customer | undefined) => boolean;
  /** Customer-linked devices match the filters; consumer and unassigned devices only when unfiltered. */
  deviceOk: (d: Device) => boolean;
  scope: string;
}

// ── Periods ─────────────────────────────────────────────────────
const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const within = (t: Date, p: { from: Date; to: Date }) => t >= p.from && t <= p.to;
const pad = (n: number) => String(n).padStart(2, '0');
const dayLabel = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;

export function rangeOptions(forward: boolean): { id: RangeKey; label: string }[] {
  return forward
    ? [
        { id: '30d', label: 'Next 30 days' },
        { id: 'quarter', label: 'Next 90 days' },
        { id: '12m', label: 'Next 12 months' },
        { id: 'ytd', label: 'Rest of the year' },
      ]
    : [
        { id: '30d', label: 'Last 30 days' },
        { id: 'quarter', label: 'Last quarter' },
        { id: '12m', label: 'Last 12 months' },
        { id: 'ytd', label: 'Year to date' },
      ];
}

export function periods(range: RangeKey, today: Date, forward = false): { period: Period; prev: Period; vs: string } {
  const t0 = startOfDay(today);
  const end = endOfDay(today);
  const y = today.getFullYear();
  if (forward) {
    const to =
      range === '30d' ? endOfDay(addDays(t0, 30))
      : range === 'quarter' ? endOfDay(addDays(t0, 90))
      : range === '12m' ? endOfDay(new Date(y + 1, today.getMonth(), today.getDate()))
      : endOfDay(new Date(y, 11, 31));
    const label = rangeOptions(true).find((o) => o.id === range)!.label.toLowerCase();
    return { period: { from: t0, to, label: `the ${label}` }, prev: { from: t0, to, label }, vs: '' };
  }
  switch (range) {
    case '30d': {
      const from = addDays(t0, -29);
      return {
        period: { from, to: end, label: 'the last 30 days' },
        prev: { from: addDays(from, -30), to: endOfDay(addDays(from, -1)), label: 'the previous 30 days' },
        vs: 'vs previous 30 days',
      };
    }
    case 'quarter': {
      const q = Math.floor(today.getMonth() / 3) - 1; // last complete quarter
      const qs = new Date(y, q * 3, 1);
      const qy = qs.getFullYear();
      const qn = ((q % 4) + 4) % 4;
      const from = new Date(qy, qn * 3, 1);
      const to = endOfDay(new Date(qy, qn * 3 + 3, 0));
      const pf = new Date(qy, qn * 3 - 3, 1);
      const pq = Math.floor(pf.getMonth() / 3) + 1;
      return {
        period: { from, to, label: `Q${qn + 1} ${qy}` },
        prev: { from: pf, to: endOfDay(new Date(qy, qn * 3, 0)), label: `Q${pq} ${pf.getFullYear()}` },
        vs: `vs Q${pq} ${pf.getFullYear()}`,
      };
    }
    case '12m': {
      const from = new Date(y, today.getMonth() - 11, 1);
      return {
        period: { from, to: end, label: 'the last 12 months' },
        prev: { from: new Date(y, today.getMonth() - 23, 1), to: endOfDay(addDays(from, -1)), label: 'the 12 months before' },
        vs: 'vs the 12 months before',
      };
    }
    case 'ytd': {
      const from = new Date(y, 0, 1);
      return {
        period: { from, to: end, label: `${y} so far` },
        prev: { from: new Date(y - 1, 0, 1), to: endOfDay(new Date(y - 1, today.getMonth(), today.getDate())), label: `the same span of ${y - 1}` },
        vs: `vs same span of ${y - 1}`,
      };
    }
  }
}

/** Weekly buckets for spans up to ~100 days, monthly beyond. */
export function bucketsFor(p: Period, today: Date): Bucket[] {
  const days = Math.round((p.to.getTime() - p.from.getTime()) / DAY);
  const out: Bucket[] = [];
  if (days <= 100) {
    for (let s = startOfDay(p.from); s <= p.to; s = addDays(s, 7)) {
      const e = endOfDay(addDays(s, 6));
      out.push({ from: s, to: e > p.to ? p.to : e, label: dayLabel(s), marked: false });
    }
    // A stub of under four days joins the week before it rather than drawing a near-empty bar.
    const last = out.at(-1);
    if (out.length > 1 && last && last.to.getTime() - last.from.getTime() < 3 * DAY) {
      out.pop();
      out[out.length - 1].to = last.to;
    }
    return out;
  }
  for (let m = new Date(p.from.getFullYear(), p.from.getMonth(), 1); m <= p.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const e = endOfDay(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    const current = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
    out.push({ from: m, to: e > p.to ? p.to : e, label: MONTHS[m.getMonth()], marked: current });
  }
  return out;
}
const bucketIndex = (bs: Bucket[], t: Date) => bs.findIndex((b) => within(t, b));
const unitOf = (bs: Bucket[]) => (bs.length && bs[0].to.getTime() - bs[0].from.getTime() < 8 * DAY ? 'week' : 'month');

export function makeCtx(store: Store, f: Filters, forward = false): Ctx {
  const today = store.today;
  const { period, prev, vs } = periods(f.range, today, forward);
  const customerOk = (c: Customer | undefined) =>
    !!c && (f.country === 'all' || c.countryCode === f.country) && (f.pkg === 'all' || c.package === f.pkg);
  const unfiltered = f.country === 'all' && f.pkg === 'all';
  const deviceOk = (d: Device) => (d.customerId == null ? unfiltered : customerOk(store.customer(d.customerId)));
  const scope = [f.country === 'all' ? null : store.country(f.country).name, f.pkg === 'all' ? null : f.pkg].filter(Boolean).join(' · ');
  return { store, f, today, period, prev, buckets: bucketsFor(period, today), vs, customerOk, deviceOk, scope };
}

// ── Device lifecycle (matches Store.deviceHistory) ──────────────
const ev = (d: Device, days: number) => addDays(new Date(d.createdAt), days);
const owned = (d: Device) => d.customerId != null || d.consumerId != null;
const allocatedAt = (d: Device) => (d.status !== 'Available' && owned(d) ? ev(d, 2) : null);
const activatedAt = (d: Device) => ((d.status === 'Sold' || d.status === 'Deactivated') && owned(d) ? ev(d, 6) : null);
const faultyAt = (d: Device) => (d.status === 'Faulty' ? ev(d, 9) : null);
/** A device already in service whose modelled date lands after today counts today (as on the overview). */
const capped = (t: Date | null, today: Date) => (t && t > today ? today : t);

// ── Helpers ─────────────────────────────────────────────────────
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const price = (store: Store, p: PackageName) => store.packages().find((x) => x.name === p)?.monthlyPrice ?? 0;
/** Package colours: steps down IoTility's brand scale, strongest first. */
const tint = (i: number) => `var(--color-brand-${[600, 400, 300, 200, 100][i] ?? 100})`;
const emptyFor = (what: string, c: Ctx) => `No ${what} in ${c.period.label}${c.scope ? ` for ${c.scope}` : ''}.`;

/** Sum every numeric column of the rows; the caller overwrites ratio columns. */
function totals(rows: Row[], cols: Col[], label: string): Row {
  const t: Row = { [cols[0].key]: label };
  for (const c of cols.slice(1)) {
    if (c.fmt === 'n' || c.fmt === 'money') t[c.key] = sum(rows, (r) => (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0));
    else t[c.key] = null;
  }
  return t;
}

/**
 * Onboarding section completion, modelled until the API stores per-section timestamps:
 * each section takes a fixed base plus a spread keyed on the customer id, and the total never
 * exceeds the days since the customer was created.
 */
const BASE = [0, 1, 0, 0, 0, 1, 2, 3, 0];
const SPREAD = [1, 2, 1, 1, 1, 1, 3, 4, 1];
export function daysToOnboard(c: Customer, today: Date): number {
  const modelled = BASE.reduce((a, b, k) => a + b + ((c.id * (k + 3) * 7) % (SPREAD[k] + 1)), 0);
  const age = Math.floor((today.getTime() - new Date(c.createdAt).getTime()) / DAY);
  return Math.max(1, Math.min(modelled, age));
}

// ── 1. Onboarding funnel ────────────────────────────────────────
const onboardingFunnel: ReportDef = {
  id: 'onboarding-funnel',
  area: 'Onboarding',
  name: 'Onboarding funnel',
  question: 'Where do customers stall in onboarding?',
  compute(c) {
    const inP = (p: Period) => c.store.customers().filter((x) => c.customerOk(x) && within(new Date(x.createdAt), p));
    const rows = inP(c.period);
    const prevRows = inP(c.prev);
    const started = rows.length;
    const done = ONBOARDING_STEPS.map((_, k) => rows.filter((x) => x.stepsDone >= k + 1).length);
    const finished = rows.filter((x) => x.stepsDone >= 9);
    const days = median(finished.map((x) => daysToOnboard(x, c.today)));
    const prevDays = median(prevRows.filter((x) => x.stepsDone >= 9).map((x) => daysToOnboard(x, c.today)));
    const stuck = rows.filter((x) => x.stepsDone < 9 && x.status === 'Active');
    const drops = done.map((n, k) => (k ? done[k - 1] : started) - n);
    const worst = drops.reduce((best, d, k) => (d > drops[best] ? k : best), 0);

    const cols: Col[] = [
      { key: 'section', label: 'Section' },
      { key: 'done', label: 'Completed', fmt: 'n', keep: true },
      { key: 'share', label: '% of started', fmt: 'pct' },
      { key: 'drop', label: 'Lost at this section', fmt: 'n' },
    ];
    const tRows: Row[] = ONBOARDING_STEPS.map((s, k) => ({ section: `${k + 1}. ${s}`, done: done[k], share: pct(done[k], started), drop: drops[k] }));
    const total = totals(tRows, cols, 'Started → finished all nine');
    total['done'] = done[8];
    total['share'] = pct(done[8], started);

    return {
      finding: !started
        ? emptyFor('new customers', c)
        : drops[worst]
          ? `${plural(drops[worst], 'customer')} stopped at “${ONBOARDING_STEPS[worst]}”, the most of any section · ${fmtNum(done[8])} of ${fmtNum(started)} finished`
          : `All ${fmtNum(started)} customers who started in ${c.period.label} finished all nine sections`,
      headline: days == null ? 'No finished onboardings' : `Median ${days} days to onboard`,
      headlineSub: `customers who started in ${c.period.label}`,
      kpis: [
        { label: 'Customers started', icon: 'building-2', tone: 'neutral', value: started, change: { n: started - prevRows.length, prev: prevRows.length, better: 'up', vs: c.vs } },
        { label: 'Finished all nine', icon: 'circle-check', tone: 'success', value: done[8], caption: `${pct(done[8], started)}% of those started` },
        {
          label: 'Median time to onboard',
          icon: 'clock',
          tone: 'neutral',
          value: days,
          suffix: ' days',
          ...(days != null && prevDays != null
            ? { change: { n: days - prevDays, prev: prevDays, better: 'down' as const, fmt: 'days' as const, vs: `vs ${prevDays} days in ${c.prev.label}` } }
            : { caption: days == null ? 'no one finished in this period' : `no finished onboardings in ${c.prev.label}` }),
        },
        { label: 'Still onboarding', icon: 'history', tone: 'warning', value: stuck.length, caption: stuck.length ? `waiting on their next section` : 'no one is part-way through' },
      ],
      chartTitle: 'Customers completing each section',
      chartSub: `Of ${plural(started, 'customer')} who started in ${c.period.label}`,
      chart: {
        kind: 'hbars',
        rows: ONBOARDING_STEPS.map((s, k) => ({
          label: `${k + 1}. ${s}`,
          value: done[k],
          pct: started ? (done[k] / started) * 100 : 0,
          display: fmtNum(done[k]),
          sub: drops[k] ? `−${drops[k]}` : undefined,
        })),
      },
      tables: [{ id: 'sections', label: 'By section', sub: 'Lost = customers who completed the section before but not this one', noun: 'sections', cols, rows: tRows, total }],
      empty: !started,
      emptyText: emptyFor('customers started onboarding', c),
      footnote:
        'Time to onboard is modelled until the API records when each section is completed: a base time per section plus a spread keyed on the customer, capped at the days since the customer was created.',
    };
  },
};

// ── 2. Activations ──────────────────────────────────────────────
const activations: ReportDef = {
  id: 'activations',
  area: 'Fleet & devices',
  name: 'Device activations',
  question: 'How fast is the fleet growing?',
  compute(c) {
    const s = c.store;
    const acts = s.devices().filter(c.deviceOk).map((d) => ({ d, at: capped(activatedAt(d), c.today) })).filter((x) => x.at) as { d: Device; at: Date }[];
    const inP = acts.filter((x) => within(x.at, c.period));
    const inPrev = acts.filter((x) => within(x.at, c.prev));
    const counts = c.buckets.map(() => 0);
    for (const x of inP) {
      const i = bucketIndex(c.buckets, x.at);
      if (i >= 0) counts[i]++;
    }
    const unit = unitOf(c.buckets);
    const complete = c.buckets.filter((b) => !b.marked).length || 1;
    const avg = Math.round((sum(counts.filter((_, i) => !c.buckets[i].marked), (n) => n) / complete) * 10) / 10;
    const best = counts.reduce((b, n, i) => (n > counts[b] ? i : b), 0);
    const inService = s.devices().filter((d) => c.deviceOk(d) && d.status === 'Sold').length;

    const custOf = (d: Device) => (d.customerId != null ? s.customer(d.customerId) : undefined);
    const split = (key: (d: Device) => string | null, names: string[], id: string, label: string, first: string): Table => {
      const cols: Col[] = [
        { key: 'name', label: first },
        { key: 'n', label: 'Activated', fmt: 'n', keep: true },
        { key: 'p', label: 'Previous period', fmt: 'n' },
        { key: 'ch', label: 'Change', fmt: 'delta' },
        { key: 'share', label: 'Share', fmt: 'pct' },
      ];
      const rows: Row[] = names
        .map((name) => {
          const n = inP.filter((x) => key(x.d) === name).length;
          const p = inPrev.filter((x) => key(x.d) === name).length;
          return { name, n, p, ch: signed(n - p, p), share: pct(n, inP.length) };
        })
        .filter((r) => r.n || r.p)
        .sort((a, b) => b.n - a.n);
      const total = totals(rows, cols, 'Total');
      total['ch'] = signed(inP.length - inPrev.length, inPrev.length);
      total['share'] = rows.length ? 100 : 0;
      return { id, label, sub: `Devices activated in ${c.period.label}, against ${c.prev.label}`, noun: label.replace('By ', ''), cols, rows, total };
    };
    const consumer = 'Consumers (Plug & Go)';
    const byPkg = split((d) => (d.consumerId != null ? consumer : custOf(d)?.package ?? null), [...PACKAGES, consumer], 'package', 'By package', 'Package');
    const byCountry = split(
      (d) => (d.consumerId != null ? consumer : custOf(d) ? s.country(custOf(d)!.countryCode).name : null),
      [...s.countries.map((x) => x.name), consumer],
      'country',
      'By country',
      'Country',
    );
    const last = c.buckets.at(-1);

    return {
      finding: inP.length
        ? `${plural(inP.length, 'device')} activated in ${c.period.label}, ${changePhrase(inP.length - inPrev.length, inPrev.length)} ${c.prev.label}`
        : emptyFor('activations', c),
      headline: `${plural(inP.length, 'device')} activated`,
      headlineSub: `in ${c.period.label}, ${signed(inP.length - inPrev.length, inPrev.length)} ${c.vs}`,
      kpis: [
        { label: 'Devices activated', icon: 'zap', tone: 'success', value: inP.length, change: { n: inP.length - inPrev.length, prev: inPrev.length, better: 'up', vs: c.vs } },
        { label: `Average per ${unit}`, icon: 'chart-line', tone: 'neutral', value: avg, decimals: avg % 1 ? 1 : 0, caption: `across ${plural(complete, `complete ${unit}`)}` },
        { label: `Busiest ${unit}`, icon: 'trending-up', tone: 'neutral', value: inP.length ? counts[best] : null, caption: inP.length ? `${unit === 'week' ? 'week of ' : ''}${c.buckets[best].label}` : '—' },
        { label: 'In service now', icon: 'cpu', tone: 'success', value: inService, caption: 'devices reporting today' },
      ],
      chartTitle: `Devices activated per ${unit}`,
      chartSub: last?.marked ? `${fmtNum(counts.at(-1)!)} so far in ${last.label}, against ${fmtNum(counts.at(-2) ?? 0)} in ${c.buckets.at(-2)?.label ?? 'the month before'}` : `${fmtNum(inP.length)} in ${c.period.label}`,
      chart: {
        kind: 'bars',
        data: c.buckets.map((b, i) => ({ label: b.label, value: counts[i], marked: b.marked })),
        legend: last?.marked ? [`Complete ${unit}`, 'This month, in progress'] : undefined,
      },
      tables: [byPkg, byCountry],
      empty: !inP.length,
      emptyText: emptyFor('devices activated', c),
      footnote: 'A device counts as activated six days after it was received into stock, as on its history timeline. Consumer devices appear only under All countries and All packages.',
    };
  },
};

// ── 3. Inventory movement ───────────────────────────────────────
const inventory: ReportDef = {
  id: 'inventory-movement',
  area: 'Fleet & devices',
  name: 'Inventory movement',
  question: 'Is stock keeping up with demand?',
  compute(c) {
    const s = c.store;
    const typeOk = (d: Device) => c.f.pkg === 'all' || s.deviceType(d.typeId).packages.includes(c.f.pkg);
    const countryOk = (d: Device) => c.f.country === 'all' || (d.customerId != null && s.customer(d.customerId)?.countryCode === c.f.country);
    const devs = s.devices().filter(typeOk);
    const series = (p: Period) => {
      const z = () => c.buckets.map(() => 0);
      const out = { received: z(), allocated: z(), activated: z(), faulty: z(), totals: { received: 0, allocated: 0, activated: 0, faulty: 0 } };
      const add = (k: 'received' | 'allocated' | 'activated' | 'faulty', t: Date | null) => {
        t = capped(t, c.today);
        if (!t || !within(t, p)) return;
        out.totals[k]++;
        const i = bucketIndex(c.buckets, t);
        if (i >= 0) out[k][i]++;
      };
      for (const d of devs) {
        add('received', new Date(d.createdAt));
        add('faulty', faultyAt(d));
        if (countryOk(d)) {
          add('allocated', allocatedAt(d));
          add('activated', activatedAt(d));
        }
      }
      return out;
    };
    const cur = series(c.period);
    const prev = series(c.prev);
    const stock = devs.filter((d) => d.status === 'Available').length;
    const weeks = Math.max(1, (c.period.to.getTime() - c.period.from.getTime()) / (7 * DAY));
    const perWeek = cur.totals.activated / weeks;
    const cover = perWeek ? Math.round((stock / perWeek) * 10) / 10 : null;
    const unit = unitOf(c.buckets);
    const partial = c.buckets.find((b) => b.marked);
    const lineBuckets = c.buckets.filter((b) => !b.marked);

    const cols: Col[] = [
      { key: 'p', label: unit === 'week' ? 'Week of' : 'Month' },
      { key: 'received', label: 'Received', fmt: 'n' },
      { key: 'allocated', label: 'Allocated', fmt: 'n' },
      { key: 'activated', label: 'Activated', fmt: 'n', keep: true },
      { key: 'faulty', label: 'Faulty', fmt: 'n' },
      { key: 'net', label: 'Received − activated', fmt: 'delta' },
    ];
    const rows: Row[] = c.buckets.map((b, i) => ({
      p: b.marked ? `${b.label} (so far)` : b.label,
      received: cur.received[i],
      allocated: cur.allocated[i],
      activated: cur.activated[i],
      faulty: cur.faulty[i],
      net: signed(cur.received[i] - cur.activated[i]),
    }));
    const total = totals(rows, cols, 'Total');
    total['net'] = signed(cur.totals.received - cur.totals.activated);
    const any = cur.totals.received + cur.totals.allocated + cur.totals.activated + cur.totals.faulty;

    return {
      finding:
        cover == null
          ? `${plural(stock, 'device')} in stock and no activations in ${c.period.label} to measure cover against`
          : `${plural(stock, 'device')} in stock cover ${cover} weeks at ${Math.round(perWeek * 10) / 10} activations a week, the pace of ${c.period.label}`,
      headline: cover == null ? `${fmtNum(stock)} devices in stock` : `${cover} weeks of stock cover`,
      headlineSub: `${fmtNum(stock)} in stock, at the activation pace of ${c.period.label}`,
      kpis: [
        { label: 'Stock cover', icon: 'calendar-clock', tone: 'neutral', value: cover, decimals: 1, suffix: ' weeks', caption: `in stock ÷ ${Math.round(perWeek * 10) / 10} activations a week` },
        { label: 'In stock now', icon: 'boxes', tone: 'neutral', value: stock, caption: 'available to allocate' },
        { label: 'Received', icon: 'download', tone: 'neutral', value: cur.totals.received, change: { n: cur.totals.received - prev.totals.received, prev: prev.totals.received, better: 'up', vs: c.vs } },
        { label: 'Activated', icon: 'zap', tone: 'success', value: cur.totals.activated, change: { n: cur.totals.activated - prev.totals.activated, prev: prev.totals.activated, better: 'up', vs: c.vs } },
      ],
      chartTitle: `Received against activated, per ${unit}`,
      chartSub: `${fmtNum(cur.totals.received)} received and ${fmtNum(cur.totals.activated)} activated in ${c.period.label}${partial ? ` · ${partial.label} so far is in the table` : ''}`,
      chart: {
        kind: 'lines',
        // A line can't mark a part-month, so the month in progress stays in the table only.
        data: lineBuckets.map((b, i) => ({ label: b.label, value: cur.activated[i] })),
        compare: lineBuckets.map((b, i) => ({ label: b.label, value: cur.received[i] })),
        legend: ['Activated', 'Received into stock'],
      },
      tables: [{ id: 'movement', label: 'Movement', sub: `Per ${unit}, in ${c.period.label}`, noun: `${unit}s`, cols, rows, total }],
      empty: !any,
      emptyText: emptyFor('stock movement', c),
      footnote:
        'Allocation and activation dates are modelled from the receipt date (+2 and +6 days), as on each device’s history. Stock isn’t held per country: the country filter applies to allocations and activations only; the package filter keeps device types sold with that package.',
    };
  },
};

// ── 4. Portfolio (MRR) ──────────────────────────────────────────
const portfolio: ReportDef = {
  id: 'portfolio',
  area: 'Commercial',
  name: 'Revenue portfolio',
  question: 'Where does monthly recurring revenue come from?',
  compute(c) {
    const s = c.store;
    const custs = s.customers().filter((x) => c.customerOk(x));
    const inService = (x: Customer) => s.devicesByCustomer().get(x.id)?.filter((d) => d.status === 'Sold') ?? [];
    const rows = custs.map((x) => {
      const devs = inService(x);
      const p = price(s, x.package);
      const before = devs.filter((d) => (capped(activatedAt(d), c.today) ?? c.today) < c.period.from).length;
      return { c: x, devices: devs.length, mrr: devs.length * p, before: before * p };
    });
    const mrr = sum(rows, (r) => r.mrr);
    const devices = sum(rows, (r) => r.devices);
    const start = sum(rows, (r) => r.before);
    const paying = rows.filter((r) => r.devices).length;

    const pkgRows = PACKAGES.map((p) => {
      const rs = rows.filter((r) => r.c.package === p);
      return { name: p, devices: sum(rs, (r) => r.devices), mrr: sum(rs, (r) => r.mrr), price: price(s, p) };
    })
      .filter((r) => r.devices)
      .sort((a, b) => b.mrr - a.mrr);

    const group = (key: (x: Customer) => string, id: string, label: string, first: string): Table => {
      const cols: Col[] = [
        { key: 'name', label: first },
        { key: 'customers', label: 'Customers', fmt: 'n' },
        { key: 'devices', label: 'Devices in service', fmt: 'n' },
        { key: 'mrr', label: 'MRR (AED)', fmt: 'money', keep: true },
        { key: 'share', label: 'Share', fmt: 'pct' },
      ];
      const names = [...new Set(rows.map((r) => key(r.c)))];
      const out: Row[] = names
        .map((name) => {
          const rs = rows.filter((r) => key(r.c) === name && r.devices);
          const m = sum(rs, (r) => r.mrr);
          return { name, customers: rs.length, devices: sum(rs, (r) => r.devices), mrr: m, share: pct(m, mrr) };
        })
        .filter((r) => r.devices)
        .sort((a, b) => b.mrr - a.mrr);
      const total = totals(out, cols, 'Total');
      total['share'] = out.length ? 100 : 0;
      return { id, label, sub: 'Devices in service × the package’s monthly price', noun: label.replace('By ', ''), cols, rows: out, total };
    };
    const top = pkgRows[0];

    return {
      finding: mrr
        ? `${top.name} brings ${pct(top.mrr, mrr)}% of ${fmtMoney(mrr)} a month from ${plural(top.devices, 'device')}`
        : `No devices in service${c.scope ? ` for ${c.scope}` : ''}.`,
      headline: `${fmtMoney(mrr)} a month`,
      headlineSub: `recurring today, from ${plural(devices, 'device')} in service`,
      kpis: [
        {
          label: 'Monthly recurring revenue',
          icon: 'receipt',
          tone: 'brand',
          value: mrr,
          prefix: 'AED ',
          change: { n: mrr - start, prev: start, better: 'up', fmt: 'money', vs: `since ${fmtDate(c.period.from.toISOString())}` },
        },
        { label: 'Devices in service', icon: 'cpu', tone: 'success', value: devices, caption: `across ${plural(paying, 'customer')}` },
        { label: 'Average per device', icon: 'tag', tone: 'neutral', value: devices ? Math.round((mrr / devices) * 100) / 100 : null, decimals: 2, prefix: 'AED ', caption: 'a month, blended across packages' },
        { label: 'Annual run rate', icon: 'trending-up', tone: 'brand', value: mrr * 12, prefix: 'AED ', caption: 'this month’s MRR × 12' },
      ],
      chartTitle: 'MRR by package',
      chartSub: `${fmtMoney(mrr)} a month from ${plural(devices, 'device')} in service`,
      chart: {
        kind: 'ring',
        segments: pkgRows.map((r, i) => ({ label: r.name, value: r.mrr, colour: tint(i) })),
        head: ['Package', 'Devices', 'Price', 'MRR', 'Share'],
        legend: pkgRows.map((r, i) => ({
          label: r.name,
          colour: tint(i),
          cells: [fmtNum(r.devices), fmtMoney(r.price), fmtMoney(r.mrr), `${pct(r.mrr, mrr).toFixed(1)}%`],
        })),
      },
      tables: [
        group((x) => x.industry, 'industry', 'By industry', 'Industry'),
        group((x) => s.country(x.countryCode).name, 'country', 'By country', 'Country'),
      ],
      empty: !mrr,
      emptyText: `No devices in service${c.scope ? ` for ${c.scope}` : ''}.`,
      footnote:
        'MRR is today’s figure: business customers’ devices in service × their package’s monthly price, in AED. The date range sets the baseline: MRR at its start counts devices already active then. Consumer accounts are billed separately and not included.',
    };
  },
};

// ── 5. Renewals ─────────────────────────────────────────────────
const renewals: ReportDef = {
  id: 'renewals',
  area: 'Commercial',
  name: 'Contract renewals',
  question: 'Which contracts end soon, and what revenue is at risk?',
  forward: true,
  compute(c) {
    const s = c.store;
    const live = s.customers().filter((x) => x.status === 'Active' && c.customerOk(x));
    const mrrOf = (x: Customer) => (s.devicesByCustomer().get(x.id)?.filter((d) => d.status === 'Sold').length ?? 0) * price(s, x.package);
    const totalMrr = sum(live, mrrOf);
    const ending = live
      .filter((x) => within(new Date(x.contractExpiry), c.period))
      .sort((a, b) => a.contractExpiry.localeCompare(b.contractExpiry));
    const months = Array.from({ length: 12 }, (_, i) => new Date(c.today.getFullYear(), c.today.getMonth() + i, 1));
    const perMonth = months.map((m) =>
      live.filter((x) => {
        const e = new Date(x.contractExpiry);
        return e >= startOfDay(c.today) && e.getFullYear() === m.getFullYear() && e.getMonth() === m.getMonth();
      }).length,
    );
    const cols: Col[] = [
      { key: 'company', label: 'Customer' },
      { key: 'pkg', label: 'Package', fmt: 'text' },
      { key: 'country', label: 'Country', fmt: 'text' },
      { key: 'ends', label: 'Contract ends', fmt: 'date' },
      { key: 'left', label: 'Days left', fmt: 'n' },
      { key: 'devices', label: 'Devices', fmt: 'n' },
      { key: 'mrr', label: 'MRR at risk (AED)', fmt: 'money', keep: true },
    ];
    const rows: Row[] = ending.map((x) => ({
      company: x.company,
      pkg: x.package,
      country: s.country(x.countryCode).name,
      ends: x.contractExpiry,
      left: Math.ceil((new Date(x.contractExpiry).getTime() - c.today.getTime()) / DAY),
      devices: s.devicesByCustomer().get(x.id)?.filter((d) => d.status === 'Sold').length ?? 0,
      mrr: mrrOf(x),
      _link: `/customers/${x.id}`,
    }));
    const total = totals(rows, cols, `${plural(rows.length, 'contract')}`);
    total['left'] = null;
    const atRisk = sum(rows, (r) => r['mrr'] as number);
    const soon = rows[0];
    const inRange = (m: Date) => m <= c.period.to;

    return {
      finding: rows.length
        ? `${plural(rows.length, 'contract')} end in ${c.period.label}, carrying ${fmtMoney(atRisk)} a month · the first is ${soon['company']} in ${soon['left']} days`
        : emptyFor('contracts ending', c),
      headline: `${fmtMoney(atRisk)} MRR up for renewal`,
      headlineSub: `${plural(rows.length, 'contract')} ending in ${c.period.label}`,
      kpis: [
        { label: 'Contracts ending', icon: 'calendar-clock', tone: 'warning', value: rows.length, caption: `of ${plural(live.length, 'active contract')}` },
        { label: 'MRR at risk', icon: 'alert', tone: 'warning', value: atRisk, prefix: 'AED ', caption: `${pct(atRisk, totalMrr)}% of ${fmtMoney(totalMrr)} a month` },
        { label: 'Devices covered', icon: 'shield', tone: 'neutral', value: sum(rows, (r) => r['devices'] as number), caption: 'in service on these contracts' },
        { label: 'First to end', icon: 'calendar', tone: 'neutral', value: soon ? (soon['left'] as number) : null, suffix: ' days', caption: soon ? `${soon['company']}` : 'nothing ends in this window' },
      ],
      chartTitle: 'Contracts ending per month',
      chartSub: `Next 12 months · ${plural(sum(perMonth, (n) => n), 'contract')}`,
      chart: {
        kind: 'bars',
        data: months.map((m, i) => ({ label: MONTHS[m.getMonth()], value: perMonth[i], marked: !inRange(m) })),
        legend: months.every(inRange) ? undefined : ['In the selected window', 'Later'],
      },
      tables: [{ id: 'contracts', label: 'Contracts', sub: `Active customers whose contract ends in ${c.period.label}, soonest first`, noun: 'contracts', cols, rows, total }],
      empty: !rows.length,
      emptyText: emptyFor('contracts ending', c),
      footnote: 'MRR at risk is the customer’s devices in service × their package’s monthly price. Inactive customers are left out.',
    };
  },
};

// ── 6. Hardware orders ──────────────────────────────────────────
const SHIP_TARGET = 3;
/** Days from order to dispatch, modelled from the order size until the API records a ship date. */
export const shipDays = (qty: number) => 1 + Math.ceil(qty / 10);

const hardwareOrders: ReportDef = {
  id: 'hardware-orders',
  area: 'Commercial',
  name: 'Hardware orders',
  question: 'Are orders shipping on time?',
  compute(c) {
    const s = c.store;
    const all = s.orders().filter((o) => c.customerOk(s.customer(o.customerId)));
    const value = (o: (typeof all)[0]) => o.quantity * s.deviceType(o.typeId).unitPrice;
    const inP = all.filter((o) => within(new Date(o.orderedAt), c.period));
    const inPrev = all.filter((o) => within(new Date(o.orderedAt), c.prev));
    const shipped = inP.filter((o) => o.status === 'Shipped' || o.status === 'Delivered');
    const open = inP.filter((o) => o.status === 'Placed' || o.status === 'Packed');
    const age = (o: (typeof all)[0]) => Math.max(0, Math.floor((c.today.getTime() - new Date(o.orderedAt).getTime()) / DAY));
    const late = open.filter((o) => age(o) > SHIP_TARGET);
    const onTime = shipped.filter((o) => shipDays(o.quantity) <= SHIP_TARGET).length;
    const avgShip = shipped.length ? Math.round((sum(shipped, (o) => shipDays(o.quantity)) / shipped.length) * 10) / 10 : null;
    const unit = unitOf(c.buckets);
    const units = c.buckets.map(() => 0);
    const per = c.buckets.map(() => ({ orders: 0, units: 0, value: 0 }));
    for (const o of inP) {
      const i = bucketIndex(c.buckets, new Date(o.orderedAt));
      if (i < 0) continue;
      units[i] += o.quantity;
      per[i].orders++;
      per[i].units += o.quantity;
      per[i].value += value(o);
    }
    const mCols: Col[] = [
      { key: 'p', label: unit === 'week' ? 'Week of' : 'Month' },
      { key: 'orders', label: 'Orders', fmt: 'n' },
      { key: 'units', label: 'Units', fmt: 'n', keep: true },
      { key: 'value', label: 'Value (AED)', fmt: 'money' },
    ];
    const mRows: Row[] = c.buckets.map((b, i) => ({ p: b.marked ? `${b.label} (so far)` : b.label, ...per[i] }));
    const sCols: Col[] = [
      { key: 'status', label: 'Status' },
      { key: 'orders', label: 'Orders', fmt: 'n', keep: true },
      { key: 'units', label: 'Units', fmt: 'n' },
      { key: 'value', label: 'Value (AED)', fmt: 'money' },
      { key: 'share', label: 'Share of orders', fmt: 'pct' },
    ];
    const sRows: Row[] = (['Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'] as const).map((st) => {
      const os = inP.filter((o) => o.status === st);
      return { status: st, orders: os.length, units: sum(os, (o) => o.quantity), value: sum(os, value), share: pct(os.length, inP.length) };
    });
    const sTotal = totals(sRows, sCols, 'Total');
    sTotal['share'] = inP.length ? 100 : 0;
    const totalValue = sum(inP, value);
    const prevValue = sum(inPrev, value);
    const oCols: Col[] = [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer', fmt: 'text' },
      { key: 'status', label: 'Status', fmt: 'text' },
      { key: 'ordered', label: 'Ordered', fmt: 'date' },
      { key: 'units', label: 'Units', fmt: 'n' },
      { key: 'days', label: 'Days to ship', fmt: 'delta', keep: true },
    ];
    const oRows: Row[] = [...inP]
      .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
      .map((o) => ({
        order: o.orderNo,
        customer: s.customer(o.customerId)?.company ?? '—',
        status: o.status,
        ordered: o.orderedAt,
        units: o.quantity,
        days:
          o.status === 'Cancelled' ? '—'
          : o.status === 'Placed' || o.status === 'Packed' ? `${age(o) > SHIP_TARGET ? 'late · ' : ''}waiting ${age(o)} d`
          : `${shipDays(o.quantity) > SHIP_TARGET ? 'late · ' : ''}${shipDays(o.quantity)} d`,
      }));
    const oTotal = totals(oRows, oCols, plural(oRows.length, 'order'));

    return {
      finding: inP.length
        ? `${onTime} of ${plural(shipped.length, 'shipped order')} left within ${SHIP_TARGET} days${late.length ? ` · ${plural(late.length, 'open order')} past ${SHIP_TARGET} days` : open.length ? ` · ${open.length} open, none late yet` : ''}`
        : emptyFor('hardware orders', c),
      headline: avgShip == null ? 'No shipped orders' : `${avgShip} days on average to ship`,
      headlineSub: `${onTime} of ${plural(shipped.length, 'order')} within ${SHIP_TARGET} days, in ${c.period.label}`,
      kpis: [
        { label: 'Orders', icon: 'truck', tone: 'neutral', value: inP.length, change: { n: inP.length - inPrev.length, prev: inPrev.length, better: 'up', vs: c.vs } },
        { label: 'Order value', icon: 'receipt', tone: 'neutral', value: totalValue, prefix: 'AED ', change: { n: totalValue - prevValue, prev: prevValue, better: 'up', fmt: 'money', vs: c.vs } },
        { label: 'Average days to ship', icon: 'clock', tone: 'neutral', value: avgShip, decimals: 1, suffix: ' days', caption: shipped.length ? `${onTime} of ${shipped.length} within the ${SHIP_TARGET}-day target` : 'nothing shipped in this period' },
        { label: 'Open past target', icon: 'alert', tone: 'warning', value: late.length, caption: `of ${plural(open.length, 'order')} waiting to ship` },
      ],
      chartTitle: `Units ordered per ${unit}`,
      chartSub: `${plural(sum(inP, (o) => o.quantity), 'unit')} across ${plural(inP.length, 'order')} in ${c.period.label}`,
      chart: {
        kind: 'bars',
        data: c.buckets.map((b, i) => ({ label: b.label, value: units[i], marked: b.marked })),
        legend: c.buckets.at(-1)?.marked ? [`Complete ${unit}`, 'This month, in progress'] : undefined,
      },
      tables: [
        { id: 'orders', label: 'Orders', sub: `Newest first · target: dispatched within ${SHIP_TARGET} days`, noun: 'orders', cols: oCols, rows: oRows, total: oTotal },
        { id: 'status', label: 'By status', sub: 'Value = units × the device type’s unit price', noun: 'statuses', cols: sCols, rows: sRows, total: sTotal },
        { id: 'period', label: unit === 'week' ? 'By week' : 'By month', sub: `Orders placed in ${c.period.label}`, noun: `${unit}s`, cols: mCols, rows: mRows, total: totals(mRows, mCols, 'Total') },
      ],
      empty: !inP.length,
      emptyText: emptyFor('hardware orders', c),
      footnote: `Ship dates aren’t recorded yet: days to ship is modelled as 1 day plus 1 per 10 units ordered. Open orders count as late after ${SHIP_TARGET} days.`,
    };
  },
};

// ── 7. Device health ────────────────────────────────────────────
const deviceHealth: ReportDef = {
  id: 'device-health',
  area: 'Fleet & devices',
  name: 'Device health',
  question: 'Which device types fail most?',
  compute(c) {
    const s = c.store;
    const recv = (p: Period) => s.devices().filter((d) => c.deviceOk(d) && within(new Date(d.createdAt), p));
    const devs = recv(c.period);
    const prevDevs = recv(c.prev);
    const faulty = devs.filter((d) => d.status === 'Faulty');
    const prevRate = pct(prevDevs.filter((d) => d.status === 'Faulty').length, prevDevs.length);
    const rate = pct(faulty.length, devs.length);
    const types = s
      .deviceTypes()
      .map((t) => {
        const ds = devs.filter((d) => d.typeId === t.id);
        const f = ds.filter((d) => d.status === 'Faulty').length;
        return { t, n: ds.length, f, rate: pct(f, ds.length) };
      })
      .filter((x) => x.n)
      .sort((a, b) => b.rate - a.rate || b.f - a.f);
    const maxRate = Math.max(...types.map((x) => x.rate), 0.1);

    const tCols: Col[] = [
      { key: 'type', label: 'Device type' },
      { key: 'make', label: 'Make', fmt: 'text' },
      { key: 'n', label: 'Received', fmt: 'n' },
      { key: 'f', label: 'Faulty', fmt: 'n' },
      { key: 'rate', label: 'Faulty rate', fmt: 'pct', keep: true },
      { key: 'warranty', label: 'Warranty', fmt: 'text' },
    ];
    const tRows: Row[] = types.map((x) => ({ type: x.t.name, make: x.t.make, n: x.n, f: x.f, rate: x.rate, warranty: `${x.t.warrantyYears} yr` }));
    const tTotal = totals(tRows, tCols, 'All types');
    tTotal['rate'] = rate;

    const vehicles = s.vehicles().filter((v) => c.customerOk(s.customer(v.customerId)));
    const offline = vehicles.filter((v) => v.state === 'Offline');
    const byCust = [...new Set(vehicles.map((v) => v.customerId))]
      .map((id) => {
        const vs = vehicles.filter((v) => v.customerId === id);
        const off = vs.filter((v) => v.state === 'Offline');
        const oldest = off.map((v) => v.updatedAt).sort()[0] ?? null;
        return { id, company: s.customer(id)?.company ?? '—', vs: vs.length, off: off.length, oldest };
      })
      .filter((x) => x.off)
      .sort((a, b) => b.off - a.off || a.company.localeCompare(b.company));
    const vCols: Col[] = [
      { key: 'company', label: 'Customer' },
      { key: 'vs', label: 'Tracked vehicles', fmt: 'n' },
      { key: 'off', label: 'Offline', fmt: 'n', keep: true },
      { key: 'share', label: 'Offline share', fmt: 'pct' },
      { key: 'oldest', label: 'Silent since', fmt: 'date' },
    ];
    const vRows: Row[] = byCust.map((x) => ({ company: x.company, vs: x.vs, off: x.off, share: pct(x.off, x.vs), oldest: x.oldest, _link: `/customers/${x.id}` }));
    const vTotal = totals(vRows, vCols, plural(vRows.length, 'customer'));
    vTotal['share'] = pct(sum(vRows, (r) => r['off'] as number), sum(vRows, (r) => r['vs'] as number));
    const worst = types[0];

    return {
      finding:
        worst && worst.f
          ? `${worst.t.name} fails most: ${worst.f} of ${fmtNum(worst.n)} received (${worst.rate.toFixed(1)}%) · ${plural(offline.length, 'vehicle')} offline now`
          : devs.length
            ? `No faulty devices among ${plural(devs.length, 'device')} received in ${c.period.label}`
            : emptyFor('devices received', c),
      headline: `${rate.toFixed(1)}% faulty rate`,
      headlineSub: `${plural(faulty.length, 'device')} of ${fmtNum(devs.length)} received in ${c.period.label}`,
      kpis: [
        {
          label: 'Faulty rate',
          icon: 'percent',
          tone: 'danger',
          value: rate,
          decimals: 1,
          suffix: '%',
          change: { n: Math.round((rate - prevRate) * 10) / 10, prev: prevRate, better: 'down', fmt: 'pct', vs: `vs ${prevRate.toFixed(1)}% in ${c.prev.label}` },
        },
        { label: 'Faulty devices', icon: 'circle-x', tone: 'danger', value: faulty.length, caption: `of ${plural(devs.length, 'device')} received` },
        { label: 'Worst type', icon: 'layers', tone: 'neutral', value: worst ? worst.rate : null, decimals: 1, suffix: '%', caption: worst ? `${worst.t.name}, ${worst.f} of ${worst.n}` : '—' },
        { label: 'Vehicles offline now', icon: 'wifi-off', tone: 'warning', value: offline.length, caption: `of ${plural(vehicles.length, 'tracked vehicle')}` },
      ],
      chartTitle: 'Faulty rate by device type',
      chartSub: `Devices received in ${c.period.label}, highest rate first`,
      chart: {
        kind: 'hbars',
        rows: types.map((x) => ({ label: x.t.name, value: x.rate, pct: (x.rate / maxRate) * 100, display: `${x.rate.toFixed(1)}%`, sub: `${x.f} of ${fmtNum(x.n)}` })),
      },
      tables: [
        { id: 'types', label: 'By device type', sub: `Devices received in ${c.period.label}`, noun: 'device types', cols: tCols, rows: tRows, total: tTotal },
        { id: 'offline', label: 'Offline vehicles', sub: 'Live now, whatever the date range · customers with at least one vehicle offline', noun: 'customers', cols: vCols, rows: vRows, total: vTotal },
      ],
      empty: !devs.length,
      emptyText: emptyFor('devices received', c),
      footnote: 'Faulty rate = devices now marked Faulty ÷ devices received in the period. Offline vehicles come from live tracking and ignore the date range.',
    };
  },
};

export const REPORTS: ReportDef[] = [onboardingFunnel, activations, inventory, deviceHealth, portfolio, renewals, hardwareOrders];
export const AREAS = ['Onboarding', 'Fleet & devices', 'Commercial'] as const;
export const reportById = (id: string | undefined) => REPORTS.find((r) => r.id === id);

// ── Wording ─────────────────────────────────────────────────────
/** "+8", "−3", "0", "+4 (new)". */
export function signed(n: number, prev?: number): string {
  if (n === 0) return '0';
  const s = `${n > 0 ? '+' : '−'}${fmtNum(Math.abs(n))}`;
  return prev === 0 && n > 0 ? `${s} (new)` : s;
}
function changePhrase(n: number, prev: number) {
  if (!n) return 'level with';
  return `${n > 0 ? 'up' : 'down'} ${fmtNum(Math.abs(n))} on`;
}

export function fmtCell(v: string | number | null | undefined, f: Fmt = 'text'): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return f === 'date' ? fmtDate(v) : v;
  switch (f) {
    case 'money':
      return fmtNum(Math.round(v));
    case 'pct':
      return `${v.toFixed(1)}%`;
    case 'days':
      return `${fmtNum(v)} d`;
    default:
      return fmtNum(v);
  }
}

export function filterSummary(f: Filters, store: Store, forward = false) {
  return [
    rangeOptions(forward).find((o) => o.id === f.range)!.label,
    f.country === 'all' ? 'All countries' : store.country(f.country).name,
    f.pkg === 'all' ? 'All packages' : f.pkg,
  ].join(' · ');
}
