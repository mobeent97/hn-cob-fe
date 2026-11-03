import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { DatePipe, MONTHS, RelativePipe, daysFrom, fmtNum } from '../../core/data/format';
import { DeviceStatus, ONBOARDING_STEPS, PackageName } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { CountUp } from '@iotility/shared-ui';
import { BarChart, ChartCard, ChartLegendItem, ChartTheme, DonutChart } from '@iotility/shared-ui';
import { BarDatum, HBarRow, RingSegment, barChart, formatNumber, hbarChart, ringSlices } from '../../shared/charts/chart-data';
import { simulateLoad } from '../../shared/ui/loading';

type Range = 6 | 12;

/**
 * Overview — the screen's one question: "Is onboarding moving, and what needs me today?"
 * Biggest block: devices activated per month (the outcome of onboarding).
 * One finding sits under the title, next to the action it drives.
 */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon, CountUp, BarChart, ChartCard, DonutChart, DatePipe, RelativePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly store = inject(Store);
  private readonly chartTheme = inject(ChartTheme);
  protected readonly fmtValue = formatNumber;
  private readonly access = inject(Access);
  /** What the signed-in user may open from here. */
  protected readonly can = {
    customers: computed(() => this.access.can('Customers')),
    newCustomer: computed(() => this.access.can('Customers', 'RW')),
    inventory: computed(() => this.access.can('Inventory')),
    orders: computed(() => this.access.can('Hardware orders')),
    packages: computed(() => this.access.can('Packages')),
    audit: computed(() => this.access.can('Audit')),
  };
  protected readonly loading = simulateLoad('dashboard');
  protected readonly range = signal<Range>(12);
  protected readonly steps = ONBOARDING_STEPS;

  protected readonly customers = this.store.customers;
  protected readonly devices = this.store.devices;

  protected readonly active = computed(() => this.customers().filter((c) => c.status === 'Active').length);
  protected readonly byStatus = computed(() => {
    const m: Record<DeviceStatus, number> = { Available: 0, Allocated: 0, Sold: 0, Deactivated: 0, Faulty: 0 };
    for (const d of this.devices()) m[d.status]++;
    return m;
  });
  protected readonly onboarding = computed(() =>
    this.customers()
      .filter((c) => c.stepsDone < 9 && c.status === 'Active')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  protected readonly expiring = computed(() =>
    this.customers()
      .filter((c) => c.status === 'Active' && daysFrom(c.contractExpiry) <= 60 && daysFrom(c.contractExpiry) >= 0)
      .sort((a, b) => a.contractExpiry.localeCompare(b.contractExpiry)),
  );
  protected readonly deletionRequests = computed(() => this.customers().filter((c) => c.deletionStatus === 'Requested'));
  protected readonly toShip = computed(() => this.store.orders().filter((o) => o.status === 'Placed' || o.status === 'Packed'));

  /** Activations per month: a device counts in the month it went into service (6 days after stock-in). */
  protected readonly activations = computed<BarDatum[]>(() => {
    const today = this.store.today;
    const months = Array.from({ length: this.range() }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (this.range() - 1 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()] };
    });
    const counts = new Map(months.map((m) => [m.key, 0]));
    for (const d of this.devices()) {
      if (d.status !== 'Sold' && d.status !== 'Deactivated') continue;
      const at = new Date(new Date(d.createdAt).getTime() + 6 * 86400000);
      const k = `${at.getFullYear()}-${at.getMonth()}`;
      if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
    }
    return months.map((m, i) => ({ label: m.label, value: counts.get(m.key)!, marked: i === months.length - 1 }));
  });
  protected readonly activationTotal = computed(() => this.activations().reduce((a, b) => a + b.value, 0));
  protected readonly thisMonth = computed(() => this.activations().at(-1)!.value);
  protected readonly lastMonth = computed(() => this.activations().at(-2)!.value);

  protected readonly ring = computed<RingSegment[]>(() => {
    const s = this.byStatus();
    return [
      { label: 'In service', value: s.Sold, colour: 'var(--color-brand-500)' },
      { label: 'Allocated', value: s.Allocated, colour: 'var(--color-info)' },
      { label: 'In stock', value: s.Available, colour: 'var(--color-muted)' },
      { label: 'Faulty', value: s.Faulty, colour: 'var(--color-danger)' },
      { label: 'Deactivated', value: s.Deactivated, colour: 'color-mix(in srgb, var(--color-muted) 35%, transparent)' },
    ];
  });

  protected readonly byPackage = computed(() => {
    const names: PackageName[] = ['Enterprise', 'Advance', 'Basic', 'Plug & Go'];
    const rows = names.map((name) => ({
      name,
      customers: this.customers().filter((c) => c.package === name).length,
      devices: this.customers()
        .filter((c) => c.package === name)
        .reduce((a, c) => a + (this.store.devicesByCustomer().get(c.id)?.filter((d) => d.status === 'Sold').length ?? 0), 0),
    }));
    const max = Math.max(...rows.map((r) => r.devices), 1);
    return rows.map((r) => ({ ...r, pct: (r.devices / max) * 100 }));
  });

  protected readonly packageRows = computed<HBarRow[]>(() =>
    this.byPackage().map((p) => ({
      label: p.name,
      value: p.devices,
      display: fmtNum(p.devices),
      // The card subtitle says the brackets are the customer count, so the label stays short: "Enterprise (6)".
      sub: String(p.customers),
    })),
  );

  // IoTility chart inputs, recoloured from the chart palette on a light/dark switch.
  protected readonly activationChart = computed(() =>
    barChart(this.activations(), 'Devices activated', this.chartTheme.palette()),
  );
  protected readonly activationLegend = computed<ChartLegendItem[]>(() => {
    const [series] = this.activationChart().series;
    return [
      { label: 'Complete month', color: series.color! },
      { label: 'This month, in progress', color: series.colors!.at(-1)! },
    ];
  });
  protected readonly ringData = computed(() => {
    this.chartTheme.palette();
    return ringSlices(this.ring());
  });
  protected readonly packageChart = computed(() =>
    hbarChart(this.packageRows(), 'Devices in service', this.chartTheme.palette()),
  );

  protected readonly finding = computed(() => {
    const n = this.onboarding().length;
    const ship = this.toShip().length;
    const exp = this.expiring().length;
    const parts = [
      n ? `${n} ${n === 1 ? 'customer is' : 'customers are'} part-way through onboarding` : null,
      ship ? `${ship} hardware ${ship === 1 ? 'order' : 'orders'} to ship` : null,
      exp ? `${exp} ${exp === 1 ? 'contract ends' : 'contracts end'} within 60 days` : null,
    ].filter(Boolean);
    const text = parts.length ? parts.join(' · ') : 'Nothing needs attention today.';
    // Scoped to one organization (or a partner): name it, with its customer count.
    const org = this.store.scopeOrg();
    if (!org) return text;
    const c = this.customers().length;
    return `${org.name} · ${c} ${c === 1 ? 'customer' : 'customers'} · ${parts.length ? text : text.charAt(0).toLowerCase() + text.slice(1)}`;
  });

  protected pct(n: number) {
    const total = this.devices().length || 1;
    return ((n / total) * 100).toFixed(1);
  }
  protected readonly fmtNum = fmtNum;
  protected readonly daysFrom = daysFrom;
  protected stepName(done: number) {
    return this.steps[Math.min(done, this.steps.length - 1)];
  }
  protected company(id: number) {
    return this.store.customer(id)?.company ?? '—';
  }
}
