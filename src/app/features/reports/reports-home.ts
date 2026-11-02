import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { fmtDate } from '../../core/data/format';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { AREAS, DEFAULT_FILTERS, REPORTS, filterSummary, makeCtx, reportById } from './report-data';
import { RUN_HOUR, ReportSchedule, cadence, nextRun, reportSchedules } from './report-schedules';
import { ScheduleDialog } from './schedule-dialog';
import { ReadOnlyNote, writeAccess } from '../tenancy';

/**
 * Reports — "Which report answers my question, and what does it say right now?"
 * A list grouped by area, each row carrying its live headline figure, then the schedules
 * that send reports by email.
 */
@Component({
  selector: 'app-reportshome',
  imports: [ReadOnlyNote, RouterLink, Icon, Menu, ScheduleDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports-home.html',
  styleUrl: './reports-home.scss',
})
export class ReportsHome {
  protected readonly store = inject(Store);
  /** Reports RW gates every write action on this screen. */
  protected readonly w = writeAccess('Reports');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('reports');

  protected readonly groups = computed(() =>
    AREAS.map((area) => ({
      area,
      reports: REPORTS.filter((r) => r.area === area).map((r) => {
        const res = r.compute(makeCtx(this.store, DEFAULT_FILTERS, r.forward));
        return { def: r, headline: res.headline, sub: res.headlineSub };
      }),
    })),
  );

  protected readonly schedules = computed(() =>
    reportSchedules()
      .map((s) => ({ s, def: reportById(s.reportId), next: s.paused ? null : nextRun(s, this.store.today) }))
      .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity)),
  );
  protected readonly activeCount = computed(() => reportSchedules().filter((s) => !s.paused).length);
  protected readonly firstRun = computed(() => this.schedules().find((x) => x.next));

  protected readonly editOpen = signal(false);
  protected readonly editing = signal<ReportSchedule | null>(null);

  protected readonly cadence = cadence;
  protected readonly reportCount = REPORTS.length;
  protected readonly runHour = String(RUN_HOUR).padStart(2, '0');
  protected date(d: Date) {
    return fmtDate(d.toISOString());
  }
  protected scope(s: ReportSchedule) {
    return filterSummary(s.filters, this.store, reportById(s.reportId)?.forward);
  }

  protected menu(s: ReportSchedule): MenuItem[] {
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(s) },
      s.paused
        ? { label: 'Resume', icon: 'play', run: () => this.setPaused(s, false) }
        : { label: 'Pause', icon: 'pause', run: () => this.setPaused(s, true) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.remove(s) },
    ];
  }

  private edit(s: ReportSchedule) {
    this.editing.set(s);
    this.editOpen.set(true);
  }
  private setPaused(s: ReportSchedule, paused: boolean) {
    reportSchedules.update((xs) => xs.map((x) => (x.id === s.id ? { ...x, paused } : x)));
    const name = reportById(s.reportId)?.name ?? 'Report';
    this.toast.show(paused ? `${name} paused` : `${name} resumed`, {
      body: paused ? 'No emails go out until you resume it.' : `Next run ${this.date(nextRun(s, this.store.today))}.`,
    });
  }
  private remove(s: ReportSchedule) {
    const before = reportSchedules();
    reportSchedules.update((xs) => xs.filter((x) => x.id !== s.id));
    this.toast.show('Schedule deleted', {
      body: `${reportById(s.reportId)?.name ?? 'Report'} stops going to ${s.recipients.length} ${s.recipients.length === 1 ? 'recipient' : 'recipients'}.`,
      action: { label: 'Undo', run: () => reportSchedules.set(before) },
    });
  }
}
