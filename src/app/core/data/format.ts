import { Pipe, PipeTransform } from '@angular/core';
import { TODAY, nowIso } from './mock-db';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const numFmt = new Intl.NumberFormat('en-GB');
const pad = (n: number) => String(n).padStart(2, '0');

/** 04 Nov 2026 — three-letter months everywhere (en-GB's "Sept" breaks column alignment). */
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
/** 04 Nov, 14:05 */
export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtNum = (n: number) => numFmt.format(n);
export const fmtMoney = (n: number, cur = 'AED') => `${cur} ${numFmt.format(Math.round(n))}`;

/** Whole days from "today" (positive = in the future). */
export const daysFrom = (iso: string) => Math.round((new Date(iso).getTime() - TODAY.getTime()) / 86400000);

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const mins = Math.round((new Date(nowIso()).getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return fmtDate(iso);
}

@Pipe({ name: 'date' })
export class DatePipe implements PipeTransform {
  transform = fmtDate;
}
@Pipe({ name: 'datetime' })
export class DateTimePipe implements PipeTransform {
  transform = fmtDateTime;
}
@Pipe({ name: 'rel' })
export class RelativePipe implements PipeTransform {
  transform = fmtRelative;
}
@Pipe({ name: 'n' })
export class NumPipe implements PipeTransform {
  transform = fmtNum;
}

/** Status → pill tone, used across every list. */
export type Tone = '' | 'positive' | 'negative' | 'warning' | 'info';
const TONES: Record<string, Tone> = {
    Active: 'positive', Sold: 'positive', Delivered: 'positive', Moving: 'positive',
    Inactive: '', Deactivated: '', Expired: '', Disabled: '', Cancelled: '', Offline: '',
    Faulty: 'negative', Requested: 'negative',
    Allocated: 'info', Shipped: 'info', Packed: 'info', Idle: 'warning',
    Available: '', Placed: 'warning',
    // IoT Hub
    Connected: 'positive', Disconnected: '', Succeeded: 'positive', Failed: 'negative', 'Timed out': 'warning',
    Queued: 'info', Pending: 'info', Registered: 'positive', 'Awaiting first connection': 'info',
    'Attestation failed': 'negative', 'In sync': 'positive', Error: 'negative', Draft: '', Paused: '',
    Invited: 'info', Suspended: 'negative',
};
export const tone = (s: string): Tone => TONES[s] ?? '';

@Pipe({ name: 'tone' })
export class TonePipe implements PipeTransform {
  transform = tone;
}
