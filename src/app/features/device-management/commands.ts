import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DateTimePipe, fmtDateTime } from '../../core/data/format';
import { CommandRecord, CommandStatus } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { downloadCsv } from '../../shared/ui/csv';
import { simulateLoad } from '../../shared/ui/loading';
import { COMMAND_TONE, fmtLatency, median } from './iot-format';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type TabId = 'All' | Exclude<CommandStatus, 'Succeeded'>;
const TAB_IDS: TabId[] = ['All', 'Failed', 'Timed out', 'Queued', 'Pending'];
const KINDS: CommandRecord['kind'][] = ['Direct method', 'C2D message', 'Twin update'];
const DAY = 86_400_000;
const retryable = (c: CommandRecord) => c.status === 'Failed' || c.status === 'Timed out';

/**
 * Commands — the screen's one question: "Did the commands we sent reach the devices?"
 * Biggest block: the command log, filtered by outcome. The subline carries the last 24 hours'
 * success rate and median response time, computed from the same rows.
 */
@Component({
  selector: 'app-commands',
  imports: [Select, SelectOption, ReadOnlyNote, RouterLink, Icon, Tabs, Pager, Dialog, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './commands.html',
  styleUrl: './commands.css',
})
export class Commands {
  protected readonly store = inject(Store);
  /** Device management RW gates every write action on this screen. */
  protected readonly w = writeAccess('Device management');
  private readonly toaster = inject(Toaster);
  protected readonly loading = simulateLoad('commands');
  protected readonly tone = COMMAND_TONE;
  protected readonly kinds = KINDS;
  protected readonly fmtLatency = fmtLatency;
  protected readonly size = 20;

  private readonly qp = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly tab = signal<TabId>(TAB_IDS.includes(this.qp.get('tab') as TabId) ? (this.qp.get('tab') as TabId) : 'All');
  protected readonly q = signal(this.qp.get('q') ?? '');
  protected readonly method = signal('');
  protected readonly kind = signal('');
  protected readonly sentBy = signal('');
  protected readonly page = signal(1);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly detailId = signal<number | null>(null);
  protected readonly detailOpen = signal(false);

  private readonly deviceById = computed(() => new Map(this.store.devices().map((d) => [d.id, d])));

  protected readonly methods = computed(() => [...new Set(this.store.commands().map((c) => c.method))].sort());
  protected readonly senders = computed(() => [...new Set(this.store.commands().map((c) => c.sentBy))].sort());

  /** Rows after every filter except the status tab: the tabs count these. */
  private readonly base = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.store
      .commands()
      .filter(
        (c) =>
          (!this.method() || c.method === this.method()) &&
          (!this.kind() || c.kind === this.kind()) &&
          (!this.sentBy() || c.sentBy === this.sentBy()) &&
          (!q || c.deviceId.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  });
  protected readonly tabs = computed<TabItem<TabId>[]>(() =>
    TAB_IDS.map((id) => ({ id, label: id, count: id === 'All' ? this.base().length : this.base().filter((c) => c.status === id).length })),
  );
  protected readonly rows = computed(() => (this.tab() === 'All' ? this.base() : this.base().filter((c) => c.status === this.tab())));
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size));
  protected readonly filtered = computed(() => !!(this.q() || this.method() || this.kind() || this.sentBy()));

  // ── Finding: last 24 h, from the rows ──
  protected readonly last24 = computed(() => {
    const from = this.store.today.getTime() - DAY;
    const xs = this.store.commands().filter((c) => new Date(c.sentAt).getTime() >= from);
    const settled = xs.filter((c) => c.status === 'Succeeded' || c.status === 'Failed' || c.status === 'Timed out');
    const ok = settled.filter((c) => c.status === 'Succeeded');
    return {
      sent: xs.length,
      settled: settled.length,
      ok: ok.length,
      rate: settled.length ? Math.round((ok.length / settled.length) * 100) : null,
      median: median(ok.map((c) => c.latencyMs!).filter((n) => n != null)),
    };
  });
  protected readonly finding = computed(() => {
    const s = this.last24();
    if (!s.sent) return 'No commands sent in the last 24 hours';
    const parts = [
      s.rate == null ? `${s.sent} sent in the last 24 h, none answered yet` : `${s.rate}% succeeded in the last 24 h (${s.ok} of ${s.settled} answered)`,
      s.median != null ? `median response ${fmtLatency(s.median)}` : null,
      s.sent > s.settled ? `${s.sent - s.settled} queued or pending` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });

  // ── Selection ──
  protected readonly pageAllSelected = computed(() => this.pageRows().length > 0 && this.pageRows().every((c) => this.selected().has(c.id)));
  protected readonly pageSomeSelected = computed(() => !this.pageAllSelected() && this.pageRows().some((c) => this.selected().has(c.id)));
  protected readonly selectedRows = computed(() => this.store.commands().filter((c) => this.selected().has(c.id)));
  protected readonly retryableSelected = computed(() => this.selectedRows().filter(retryable));

  protected readonly detail = computed(() => {
    const id = this.detailId();
    return id == null ? null : this.store.commands().find((c) => c.id === id) ?? null;
  });
  protected readonly requestJson = computed(() => {
    const c = this.detail();
    if (!c) return '';
    const body: Record<string, unknown> = { deviceId: c.deviceId, kind: c.kind };
    if (c.kind === 'Direct method') Object.assign(body, { methodName: c.method, payload: c.payload, responseTimeoutInSeconds: 30 });
    else if (c.kind === 'C2D message') Object.assign(body, { messageType: c.method, payload: c.payload, ack: 'full', expiryHours: 48 });
    else Object.assign(body, { patch: { properties: { desired: c.payload } } });
    return JSON.stringify(body, null, 2);
  });
  protected readonly responseJson = computed(() => {
    const c = this.detail();
    if (!c) return '';
    if (c.status === 'Pending') return '';
    return JSON.stringify({ status: c.status, responseCode: c.responseCode, payload: c.response, latencyMs: c.latencyMs }, null, 2);
  });

  protected customerOf(deviceId: string) {
    const d = this.deviceById().get(deviceId);
    if (!d) return '—';
    if (d.customerId) return this.store.customer(d.customerId)?.company ?? '—';
    return d.consumerId ? 'Consumer account' : 'In stock';
  }
  protected payloadText(c: CommandRecord) {
    return Object.keys(c.payload).length ? JSON.stringify(c.payload) : '{}';
  }

  protected setTab(t: TabId) {
    this.tab.set(t);
    this.page.set(1);
  }
  protected setFilter(sig: { set(v: string): void }, v: string) {
    sig.set(v);
    this.page.set(1);
  }
  protected clearFilters() {
    this.q.set('');
    this.method.set('');
    this.kind.set('');
    this.sentBy.set('');
    this.tab.set('All');
    this.page.set(1);
  }

  protected toggle(id: number, on: boolean) {
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
      for (const c of this.pageRows()) {
        if (on) n.add(c.id);
        else n.delete(c.id);
      }
      return n;
    });
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }

  protected open(c: CommandRecord) {
    this.detailId.set(c.id);
    this.detailOpen.set(true);
  }

  /** The reply a successful run of this method gave before, so a simulated retry answers alike. */
  private okText(c: CommandRecord) {
    return this.store.commands().find((x) => x.method === c.method && x.status === 'Succeeded')?.response ?? 'OK';
  }
  private resend(c: CommandRecord) {
    return this.store.sendCommand(c.deviceId, c.method, c.kind, c.payload, this.okText(c));
  }

  protected retry(c: CommandRecord) {
    const rec = this.resend(c);
    this.detailId.set(rec.id); // follow the new attempt; its status updates live
    this.toaster.show(`${c.method} re-sent to ${c.deviceId}`, { tone: 'info', body: `Command #${rec.id}` });
  }

  protected retrySelected() {
    const xs = this.retryableSelected();
    const skipped = this.selected().size - xs.length;
    if (!xs.length) return;
    xs.forEach((c) => this.resend(c));
    this.clearSelection();
    this.setTab('All');
    this.toaster.show(`Retried ${xs.length} ${xs.length === 1 ? 'command' : 'commands'}`, {
      tone: 'info',
      body: skipped ? `${skipped} skipped: only failed or timed-out commands are retried.` : 'Results appear in the log as devices answer.',
    });
  }

  protected async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toaster.show(`${what} copied`);
    } catch {
      this.toaster.error(`Couldn't copy the ${what.toLowerCase()}`, 'The browser blocked clipboard access.');
    }
  }

  protected export() {
    downloadCsv(
      `commands-${this.tab().toLowerCase().replace(/\s+/g, '-')}.csv`,
      this.rows().map((c) => ({
        id: c.id,
        sent: fmtDateTime(c.sentAt),
        device: c.deviceId,
        customer: this.customerOf(c.deviceId),
        method: c.method,
        kind: c.kind,
        payload: JSON.stringify(c.payload),
        status: c.status,
        responseCode: c.responseCode,
        response: c.response,
        latencyMs: c.latencyMs,
        sentBy: c.sentBy,
      })),
    );
  }
}
