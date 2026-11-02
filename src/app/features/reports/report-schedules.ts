import { signal } from '@angular/core';
import { Filters } from './report-data';

export type Frequency = 'Weekly' | 'Monthly';

export interface ReportSchedule {
  id: number;
  reportId: string;
  frequency: Frequency;
  /** Weekly: 1 (Monday) to 7 (Sunday). Monthly: day of the month, 1 to 28. */
  day: number;
  recipients: string[];
  filters: Filters;
  paused: boolean;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Scheduled reports go out at 07:00 Gulf time. */
export const RUN_HOUR = 7;

/** Report schedules, in memory for the design phase (becomes /api/report-schedules). */
export const reportSchedules = signal<ReportSchedule[]>([
  {
    id: 1,
    reportId: 'onboarding-funnel',
    frequency: 'Weekly',
    day: 1,
    recipients: ['hira.qureshi@hypernymbiz.com', 'ahmed.hashimi@hypernymbiz.com'],
    filters: { range: '30d', country: 'all', pkg: 'all' },
    paused: false,
  },
  {
    id: 2,
    reportId: 'renewals',
    frequency: 'Monthly',
    day: 1,
    recipients: ['mobeen.tahir@hypernymbiz.com', 'sophie.mitchell@hypernymbiz.com', 'nadia.farouk@hypernymbiz.com'],
    filters: { range: 'quarter', country: 'AE', pkg: 'all' },
    paused: false,
  },
  {
    id: 3,
    reportId: 'inventory-movement',
    frequency: 'Weekly',
    day: 4,
    recipients: ['usman.siddiqui@hypernymbiz.com', 'ali.raza@hypernymbiz.com'],
    filters: { range: 'quarter', country: 'all', pkg: 'all' },
    paused: true,
  },
]);

export function nextRun(s: Pick<ReportSchedule, 'frequency' | 'day'>, today: Date): Date {
  const at = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), RUN_HOUR);
  if (s.frequency === 'Weekly') {
    const dow = ((today.getDay() + 6) % 7) + 1; // Monday = 1
    let ahead = (s.day - dow + 7) % 7;
    if (ahead === 0 && today >= at(today)) ahead = 7;
    return at(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead));
  }
  const thisMonth = at(new Date(today.getFullYear(), today.getMonth(), s.day));
  return thisMonth > today ? thisMonth : at(new Date(today.getFullYear(), today.getMonth() + 1, s.day));
}

export function cadence(s: Pick<ReportSchedule, 'frequency' | 'day'>): string {
  if (s.frequency === 'Weekly') return `Weekly, ${WEEKDAYS[s.day - 1]}`;
  const n = s.day;
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `Monthly, ${n}${suffix}`;
}

export function saveSchedule(s: ReportSchedule) {
  reportSchedules.update((xs) => (xs.some((x) => x.id === s.id) ? xs.map((x) => (x.id === s.id ? s : x)) : [...xs, s]));
}
export const nextScheduleId = () => Math.max(0, ...reportSchedules().map((x) => x.id)) + 1;
