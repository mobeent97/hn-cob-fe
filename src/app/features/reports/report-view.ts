import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { fmtDateTime, fmtMoney, fmtNum } from '../../core/data/format';
import { BarChart, LineChart, Ring, HBarChart } from '../../shared/charts/charts';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import {
  Col, DEFAULT_FILTERS, Filters, Kpi, PACKAGES, RangeKey, Row, fmtCell, filterSummary, makeCtx, rangeOptions, reportById,
} from './report-data';
import { ScheduleDialog } from './schedule-dialog';
import { writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

/**
 * Report — one shared frame for every report: "What does this report answer for the chosen period?"
 * The question sits under the title, the answer in one sentence above the figures, then the KPI
 * strip (each naming its baseline), the chart that answers the question, and the breakdown table
 * whose totals row is summed from its own rows.
 */
@Component({
  selector: 'app-reportview',
  imports: [HBarChart, Select, SelectOption, RouterLink, Icon, Tabs, AnimatedNumber, BarChart, LineChart, Ring, ScheduleDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-view.html',
  styleUrl: './report-view.scss',
})
export class ReportView {
  protected readonly store = inject(Store);
  /** Reports RW gates every write action on this screen. */
  protected readonly w = writeAccess('Reports');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('report-view');

  readonly id = input<string>();
  /** Optional ?range=&country=&pkg= so a filtered report can be linked to. */
  readonly rangeParam = input<string | undefined>(undefined, { alias: 'range' });
  readonly countryParam = input<string | undefined>(undefined, { alias: 'country' });
  readonly pkgParam = input<string | undefined>(undefined, { alias: 'pkg' });

  protected readonly def = computed(() => reportById(this.id()));
  protected readonly filters = signal<Filters>(DEFAULT_FILTERS);
  protected readonly tableId = signal('');
  protected readonly scheduleOpen = signal(false);

  protected readonly packages = PACKAGES;
  protected readonly countries = this.store.countries;
  protected readonly ranges = computed(() => rangeOptions(!!this.def()?.forward));
  protected readonly fresh = fmtDateTime(this.store.today.toISOString());

  protected readonly result = computed(() => {
    const d = this.def();
    return d ? d.compute(makeCtx(this.store, this.filters(), d.forward)) : null;
  });
  protected readonly isDefault = computed(() => {
    const f = this.filters();
    return f.range === DEFAULT_FILTERS.range && f.country === 'all' && f.pkg === 'all';
  });
  protected readonly summary = computed(() => filterSummary(this.filters(), this.store, this.def()?.forward));

  protected readonly tabs = computed<TabItem[]>(() => (this.result()?.tables ?? []).map((t) => ({ id: t.id, label: t.label, count: t.rows.length })));
  protected readonly table = computed(() => {
    const ts = this.result()?.tables ?? [];
    return ts.find((t) => t.id === this.tableId()) ?? ts[0];
  });

  constructor() {
    // A new report starts from the linked (or default) filters and its first table.
    effect(() => {
      this.id();
      const range = this.rangeParam();
      const country = this.countryParam();
      const pkg = this.pkgParam();
      this.filters.set({
        range: (['30d', 'quarter', '12m', 'ytd'] as RangeKey[]).find((r) => r === range) ?? DEFAULT_FILTERS.range,
        country: this.countries.some((c) => c.code === country) ? country! : 'all',
        pkg: PACKAGES.find((p) => p === pkg) ?? 'all',
      });
      this.tableId.set('');
    });
  }

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    this.filters.update((f) => ({ ...f, [key]: value }));
  }
  protected setRange(v: string) {
    this.setFilter('range', v as RangeKey);
  }
  protected reset() {
    this.filters.set(DEFAULT_FILTERS);
  }

  // ── KPI wording ────────────────────────────────────────────
  protected changeText(k: Kpi): string {
    const c = k.change!;
    if (c.n === 0) return c.fmt === 'pct' ? '0.0 pts' : '0';
    const sign = c.n > 0 ? '+' : '−';
    const a = Math.abs(c.n);
    const body =
      c.fmt === 'money' ? fmtMoney(a)
      : c.fmt === 'pct' ? `${a.toFixed(1)} pts`
      : c.fmt === 'days' ? `${fmtNum(a)} ${a === 1 ? 'day' : 'days'}`
      : fmtNum(a);
    return `${sign}${body}${c.prev === 0 && c.n > 0 ? ' (new)' : ''}`;
  }
  protected changeTone(k: Kpi): string {
    const c = k.change!;
    if (c.n === 0 || c.prev === 0) return 'flat';
    return (c.n > 0) === (c.better === 'up') ? 'good' : 'bad';
  }

  // ── Table cells ────────────────────────────────────────────
  protected cell(r: Row, c: Col) {
    return fmtCell(r[c.key], c.fmt);
  }
  protected isNum(c: Col) {
    return c.fmt !== undefined && c.fmt !== 'text';
  }
  protected keepCol(cols: Col[]) {
    return cols.find((c) => c.keep);
  }
  /** Line 2 of a phone row: every secondary column, labelled. */
  protected phoneLine(r: Row, cols: Col[]) {
    return cols
      .slice(1)
      .filter((c) => !c.keep && r[c.key] != null)
      .map((c) => `${c.label} ${this.cell(r, c)}`)
      .join(' · ');
  }

  // ── Actions ────────────────────────────────────────────────
  protected exportCsv() {
    const t = this.table();
    const d = this.def();
    if (!t || !d || !t.rows.length) return;
    const toRow = (r: Row) => Object.fromEntries(t.cols.map((c) => [c.label, r[c.key] ?? ''])) as Record<string, string | number>;
    const rows = [...t.rows, ...(t.total ? [t.total] : [])].map(toRow);
    const f = this.filters();
    downloadCsv(`${d.id}-${t.id}-${f.range}${f.country === 'all' ? '' : '-' + f.country}-${this.store.today.toISOString().slice(0, 10)}.csv`, rows);
    this.toast.show('Export ready', { body: `${t.label}: ${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'}${t.total ? ' and the total' : ''}, ${this.summary()}.`, tone: 'info' });
  }

  protected print() {
    window.print();
  }
}
