// Small helpers shared by the Fleet health and Commands screens.
import { CommandStatus } from '../../core/data/models';
import { Tone } from '../../core/data/format';

export const COMMAND_TONE: Record<CommandStatus, Tone> = {
  Succeeded: 'positive',
  Failed: 'negative',
  'Timed out': 'warning',
  Queued: 'info',
  Pending: '',
};

/** 212653 → "212.7k", 800000 → "800k", 6000000 → "6M". */
export function compact(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(n);
}

/** 1240 → "1.2 s", 640 → "640 ms". */
export function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${+(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Two-digit hour for chart axes ("09"); 24 labels fit without colliding. */
export const hourLabel = (h: number) => pad(h);
