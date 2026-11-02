// Helpers for the Configuration profiles screen: the target-condition builder, the desired-setting
// catalogue, and the IoT Hub rule for which profile wins a device.
import { ConfigProfile, TwinValue } from '../../core/data/models';

// ── Target condition ──────────────────────────────────────────
export type TagKey = 'package' | 'deviceType' | 'customerId' | 'country' | 'useCase';
export type Op = '=' | '!=' | 'in';
export interface Clause {
  tag: TagKey;
  op: Op;
  values: string[];
}

export const TAG_KEYS: { key: TagKey; label: string }[] = [
  { key: 'package', label: 'Package' },
  { key: 'deviceType', label: 'Device type' },
  { key: 'customerId', label: 'Customer' },
  { key: 'country', label: 'Country' },
  { key: 'useCase', label: 'Use case' },
];
export const OPS: { op: Op; label: string }[] = [
  { op: '=', label: 'is' },
  { op: '!=', label: 'is not' },
  { op: 'in', label: 'is any of' },
];

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Builder rows → IoT Hub syntax. No rows → '*' (every device). */
export function toCondition(rows: Clause[]): string {
  const parts = rows
    .filter((r) => r.values.length)
    .map((r) => (r.op === 'in' ? `tags.${r.tag} IN [${r.values.map(q).join(',')}]` : r.op === '=' ? `tags.${r.tag}=${q(r.values[0])}` : `tags.${r.tag} != ${q(r.values[0])}`));
  return parts.length ? parts.join(' AND ') : '*';
}

const KEYS = new Set<string>(TAG_KEYS.map((t) => t.key));

/**
 * Parses the subset the portal writes (the same subset `matchesTarget` evaluates). Returns rows,
 * or an error naming the clause that can't be read, so raw edits never save a silent no-match.
 */
export function parseCondition(text: string): { rows: Clause[]; error: string | null } {
  const t = text.trim();
  if (!t || t === '*') return { rows: [], error: null };
  const rows: Clause[] = [];
  for (const raw of t.split(/\s+AND\s+/i)) {
    const c = raw.trim();
    let m = c.match(/^tags\.(\w+)\s+IN\s+\[(.*)\]$/i);
    if (m) {
      const vals = m[2].split(',').map((v) => v.trim());
      if (!vals.length || vals.some((v) => !/^'.*'$/.test(v))) return { rows, error: `Quote every value in “${c}”.` };
      if (!KEYS.has(m[1])) return { rows, error: `Unknown tag “${m[1]}”. Use ${[...KEYS].join(', ')}.` };
      rows.push({ tag: m[1] as TagKey, op: 'in', values: vals.map((v) => v.slice(1, -1)) });
      continue;
    }
    m = c.match(/^tags\.(\w+)\s*(=|!=)\s*'(.*)'$/);
    if (m) {
      if (!KEYS.has(m[1])) return { rows, error: `Unknown tag “${m[1]}”. Use ${[...KEYS].join(', ')}.` };
      rows.push({ tag: m[1] as TagKey, op: m[2] as Op, values: [m[3]] });
      continue;
    }
    if (/\bOR\b/i.test(c)) return { rows, error: 'OR isn’t supported. Make a second profile instead.' };
    return { rows, error: `Can’t read “${c}”. Write tags.name='value', tags.name != 'value' or tags.name IN ['a','b'], joined by AND.` };
  }
  return { rows, error: null };
}

// ── Desired settings ──────────────────────────────────────────
export type SettingKind = 'number' | 'boolean' | 'enum' | 'text';
export interface SettingMeta {
  key: string;
  label: string;
  kind: SettingKind;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  default: TwinValue;
  hint?: string;
}

export const SETTINGS: SettingMeta[] = [
  { key: 'reportIntervalMovingSec', label: 'Report interval, moving', kind: 'number', unit: 's', min: 5, max: 600, default: 30 },
  { key: 'reportIntervalStoppedSec', label: 'Report interval, stopped', kind: 'number', unit: 's', min: 30, max: 86400, default: 600 },
  { key: 'overspeedKmh', label: 'Overspeed threshold', kind: 'number', unit: 'km/h', min: 30, max: 200, default: 120 },
  { key: 'harshEventSensitivity', label: 'Harsh event sensitivity', kind: 'enum', options: ['low', 'medium', 'high'], default: 'medium' },
  { key: 'canBusEnabled', label: 'CAN bus data', kind: 'boolean', default: true },
  { key: 'firmware', label: 'Firmware', kind: 'text', default: '03.28.07.Rev.02', hint: 'Exact version string the device reports.' },
  { key: 'temperatureIntervalSec', label: 'Temperature interval', kind: 'number', unit: 's', min: 10, max: 3600, default: 60 },
  { key: 'temperatureAlarmC', label: 'Temperature alarm above', kind: 'number', unit: '°C', min: -30, max: 30, default: 8 },
  { key: 'videoResolution', label: 'Video resolution', kind: 'enum', options: ['720p', '1080p', '1440p'], default: '1080p' },
  { key: 'eventClipSeconds', label: 'Event clip length', kind: 'number', unit: 's', min: 5, max: 60, default: 20 },
  { key: 'audioRecording', label: 'Cabin audio recording', kind: 'boolean', default: false },
];
export const SETTING = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingError(key: string, v: TwinValue): string | null {
  const m = SETTING.get(key);
  if (!m) return null;
  if (m.kind === 'number') {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'Enter a number.';
    if (!Number.isInteger(v)) return 'Use a whole number.';
    if (v < m.min! || v > m.max!) return `Between ${m.min} and ${m.max} ${m.unit ?? ''}.`.trim();
  }
  if (m.kind === 'text' && !String(v).trim()) return 'Enter a value.';
  return null;
}

/** Short human value for a setting, e.g. "15 s", "On", "1080p". */
export function fmtSetting(key: string, v: TwinValue): string {
  const m = SETTING.get(key);
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  return m?.unit ? `${v} ${m.unit}` : String(v);
}

// ── The IoT Hub rule ──────────────────────────────────────────
/**
 * IoT Hub applies exactly one automatic configuration per device: the highest priority among
 * those whose condition matches. Ties go to the one created most recently. Nothing merges.
 */
export function ranks(a: ConfigProfile, b: ConfigProfile): number {
  return b.priority - a.priority || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
