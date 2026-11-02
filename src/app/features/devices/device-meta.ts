// Labels, command catalogue and sample series for the device page. Design-phase helpers only.
import { CommandRecord, CommandStatus, DeviceTwin, IotDeviceState, TwinValue } from '../../core/data/models';
import { TODAY, hubHours } from '../../core/data/mock-db';
import { fmtRelative } from '../../core/data/format';
import { LinePoint } from '../../shared/charts/charts';

// ── Twin settings: human labels and editors ───────────────────
export interface SettingMeta {
  label: string;
  unit?: string;
  kind: 'number' | 'select' | 'toggle' | 'text';
  min?: number;
  max?: number;
  options?: string[];
}

export const SETTINGS: Record<string, SettingMeta> = {
  reportIntervalMovingSec: { label: 'Report interval while moving', unit: 's', kind: 'number', min: 5, max: 3600 },
  reportIntervalStoppedSec: { label: 'Report interval while stopped', unit: 's', kind: 'number', min: 30, max: 86400 },
  overspeedKmh: { label: 'Overspeed alert above', unit: 'km/h', kind: 'number', min: 30, max: 200 },
  harshEventSensitivity: { label: 'Harsh driving sensitivity', kind: 'select', options: ['low', 'medium', 'high'] },
  canBusEnabled: { label: 'CAN bus data', kind: 'toggle' },
  firmware: { label: 'Firmware version', kind: 'select' },
  videoResolution: { label: 'Video resolution', kind: 'select', options: ['720p', '1080p', '1440p'] },
  eventClipSeconds: { label: 'Event clip length', unit: 's', kind: 'number', min: 5, max: 60 },
  audioRecording: { label: 'Cabin audio recording', kind: 'toggle' },
  temperatureIntervalSec: { label: 'Temperature interval', unit: 's', kind: 'number', min: 10, max: 3600 },
  temperatureAlarmC: { label: 'Temperature alarm above', unit: '°C', kind: 'number', min: -30, max: 30 },
};

export function settingMeta(key: string, sample: TwinValue | undefined): SettingMeta {
  return (
    SETTINGS[key] ?? {
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      kind: typeof sample === 'boolean' ? 'toggle' : typeof sample === 'number' ? 'number' : 'text',
    }
  );
}

export function fmtTwin(key: string, v: TwinValue | undefined): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  const unit = SETTINGS[key]?.unit;
  if (typeof v === 'number') return unit ? `${v.toLocaleString('en-GB')} ${unit}` : v.toLocaleString('en-GB');
  return key === 'harshEventSensitivity' ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

export function validateSetting(meta: SettingMeta, v: TwinValue): string | null {
  if (meta.kind === 'number') {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'Enter a number.';
    if (!Number.isInteger(v)) return 'Use a whole number.';
    if (meta.min !== undefined && v < meta.min) return `At least ${meta.min}${meta.unit ? ' ' + meta.unit : ''}.`;
    if (meta.max !== undefined && v > meta.max) return `At most ${meta.max.toLocaleString('en-GB')}${meta.unit ? ' ' + meta.unit : ''}.`;
  }
  if (meta.kind === 'text' && !String(v).trim()) return 'Enter a value.';
  return null;
}

// ── Commands the portal can send ──────────────────────────────
export interface CommandDef {
  id: string;
  label: string;
  method: string;
  kind: CommandRecord['kind'];
  payload: Record<string, TwinValue>;
  ok: string;
  hint: string;
  critical?: boolean;
  /** Dashcams (JT/T 808 gateway) only take the generic commands. */
  dashcam?: boolean;
  /** Takes a parameter id and value from the form. */
  param?: boolean;
}

export const COMMAND_DEFS: CommandDef[] = [
  { id: 'locate', label: 'Locate', method: 'getgps', kind: 'Direct method', payload: {}, ok: 'GPS:1 Sat:11 Lat:25.2048 Long:55.2708 Alt:12 Speed:0', hint: 'Asks for a fresh GNSS fix.' },
  { id: 'beep', label: 'Beep', method: 'beep', kind: 'Direct method', payload: { durationSec: 3 }, ok: 'Buzzer ON for 3 s', hint: 'Sounds the buzzer for 3 s so a fitter can find the unit.' },
  { id: 'immobilise', label: 'Immobilise', method: 'setdigout', kind: 'Direct method', payload: { output: 1, state: 1 }, ok: 'DOUT1:1 Timeout:INFINITY', hint: 'Cuts the starter relay on DOUT1.', critical: true },
  { id: 'restore', label: 'Restore ignition', method: 'setdigout', kind: 'Direct method', payload: { output: 1, state: 0 }, ok: 'DOUT1:0 Timeout:INFINITY', hint: 'Releases the starter relay on DOUT1.' },
  { id: 'reboot', label: 'Reboot', method: 'cpureset', kind: 'Direct method', payload: {}, ok: 'Rebooting', hint: 'Restarts the device; it reconnects in about a minute.', dashcam: true },
  { id: 'info', label: 'Device info', method: 'getinfo', kind: 'Direct method', payload: {}, ok: 'INI:2026/10/12 08:14 RTC:2026/11/02 09:12 RST:2 ERR:0', hint: 'Returns uptime, resets and error counters.', dashcam: true },
  { id: 'setparam', label: 'Set parameter', method: 'setparam', kind: 'C2D message', payload: {}, ok: 'New value', hint: 'Writes one configurator parameter. Sent as a C2D message, so it waits for an offline device.', param: true },
];

/** The label people know a recorded command by. */
export function commandLabel(c: Pick<CommandRecord, 'method' | 'payload'>): string {
  if (c.method === 'setdigout') return c.payload['state'] === 0 ? 'Restore ignition' : 'Immobilise';
  if (c.method === 'firmware') return 'Firmware update';
  return COMMAND_DEFS.find((d) => d.method === c.method)?.label ?? c.method;
}

export const compactPayload = (p: Record<string, TwinValue>) => {
  const e = Object.entries(p);
  return e.length ? e.map(([k, v]) => `${k}=${v}`).join(' ') : '—';
};

export const commandTone = (s: CommandStatus) =>
  ({ Succeeded: 'positive', Failed: 'negative', 'Timed out': 'warning', Queued: 'info', Pending: '' })[s];

export type SyncState = 'In sync' | 'Pending' | 'Error' | 'Not configured';
export const syncTone = (s: SyncState) =>
  ({ 'In sync': 'positive', Pending: 'warning', Error: 'negative', 'Not configured': '' })[s];

// ── Time helpers ──────────────────────────────────────────────
/** "3 d", "5 h", "12 min" — how long since a moment, without "ago". */
export function since(iso: string | null | undefined): string {
  if (!iso) return '—';
  const mins = Math.max(0, Math.round((TODAY.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

// ── Sample telemetry ──────────────────────────────────────────
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * External voltage, hourly, for the 24 h up to the device's last message. Deterministic per
 * device: alternator charge (~14 V / ~28 V) while the shift is driving, resting battery otherwise,
 * ending on the value the device last reported.
 */
export function voltageSeries(deviceId: string, last: number, endIso: string): LinePoint[] {
  const r = seeded(hash(deviceId));
  const heavy = last > 20; // 24 V truck system
  const rest = heavy ? 25.1 : 12.5;
  const charge = heavy ? 27.9 : 14.05;
  const start = 6 + Math.floor(r() * 3);
  const end = 16 + Math.floor(r() * 4);
  const endH = hubHours(new Date(endIso));
  const pts: LinePoint[] = [];
  for (let i = 23; i >= 0; i--) {
    const h = (endH - i + 24) % 24;
    const driving = h >= start && h <= end && r() > 0.15;
    const base = driving ? charge : rest - (h < 5 ? 0.15 : 0);
    const v = i === 0 ? last : +(base + (r() - 0.5) * (heavy ? 0.5 : 0.25)).toFixed(2);
    pts.push({ label: `${String(h).padStart(2, '0')}:00`, value: v });
  }
  return pts;
}

/** The one-line answer under the header. */
export function finding(s: IotDeviceState, t: DeviceTwin | undefined, sync: string, profileUpdated: string | null, fmtDay: (iso: string) => string): string {
  const queued = s.c2dQueued ? `, ${s.c2dQueued} ${s.c2dQueued === 1 ? 'command' : 'commands'} queued` : '';
  if (s.registration === 'Disabled') return 'Disabled in IoT Hub: the device can’t connect until it’s enabled again.';
  if (s.registration === 'Attestation failed') return `DPS attestation failed: the device’s credentials don’t match enrollment group ${s.enrollmentGroup}.`;
  if (s.registration === 'Awaiting first connection') return 'Waiting for first connection: the device gets its configuration when it first connects through DPS.';
  const offline = s.connection === 'Disconnected';
  if (sync === 'Error') return `The device rejected configuration v${t?.desired.version}: ${String(t?.reported.props['$configError'])}${offline ? ` — offline ${since(s.lastActivity)}` : ''}${queued}.`;
  if (sync === 'Pending') {
    const at = profileUpdated ?? t?.desired.updatedAt;
    return offline
      ? `Configuration pending since ${at ? fmtDay(at) : '—'} — device offline ${since(s.lastActivity)}${queued}.`
      : `Configuration v${t?.desired.version} sent ${fmtRelative(at)} — waiting for the device to report it.`;
  }
  if (offline) return `Offline ${since(s.lastActivity)}; configuration was in sync when it last reported${queued}.`;
  return `Online for ${since(s.connectedSince)}, ${sync === 'In sync' ? 'configuration in sync' : 'no configuration profile'}, ${s.messagesToday.toLocaleString('en-GB')} messages today.`;
}
