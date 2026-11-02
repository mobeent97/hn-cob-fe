import { MONTHS } from '../../core/data/format';
import { TODAY } from '../../core/data/mock-db';
import { AppNotification } from '../../core/data/models';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday", then "Sat 31 Oct" (with the year when it isn't this year). */
export function dayLabel(iso: string, today: Date = TODAY): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(today) - startOfDay(d)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const year = d.getFullYear() === today.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

export interface DayGroup {
  label: string;
  items: AppNotification[];
}

/** Rows arrive newest first; consecutive rows on the same day share a heading. */
export function groupByDay(rows: AppNotification[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const n of rows) {
    const label = dayLabel(n.at);
    const last = out[out.length - 1];
    if (last?.label === label) last.items.push(n);
    else out.push({ label, items: [n] });
  }
  return out;
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
