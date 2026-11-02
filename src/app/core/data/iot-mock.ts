// Sample Azure IoT Hub state for the design phase, derived from the device rows in mock-db so
// every device in Inventory has a matching identity, twin and history. Nothing here is real.
import { CUSTOMERS, DEVICES, DEVICE_TYPES, TODAY, USERS, VEHICLES, hubHours, hubMinutes } from './mock-db';
import {
  CommandRecord, CommandStatus, ConfigProfile, ConnectionEvent, Device, DeviceTwin, EnrollmentGroup,
  HubMetrics, IotDeviceState, IotRegistration, IotTransport, TwinValue,
} from './models';

// Own seed, so adding IoT data never reshuffles the rest of the sample data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(80823);
const int = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const minsAgo = (m: number) => new Date(TODAY.getTime() - m * 60000).toISOString();
const hex = (n: number) => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');

export const HUB_NAME = 'hn-fleet-hub-dev';

// ── Target conditions ─────────────────────────────────────────
/**
 * Evaluates an IoT Hub target condition against twin tags. Supports the subset the portal
 * writes: `tags.x='v'`, `tags.x IN ['a','b']`, `tags.x != 'v'`, joined by AND.
 */
export function matchesTarget(condition: string, tags: Record<string, unknown>): boolean {
  if (!condition.trim() || condition.trim() === '*') return true;
  return condition.split(/\s+AND\s+/i).every((clause) => {
    const c = clause.trim();
    let m = c.match(/^tags\.(\w+)\s+IN\s+\[(.*)\]$/i);
    if (m) {
      const vals = m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
      return vals.includes(String(tags[m[1]] ?? ''));
    }
    m = c.match(/^tags\.(\w+)\s*(=|!=)\s*'(.*)'$/);
    if (m) {
      const eq = String(tags[m[1]] ?? '') === m[3];
      return m[2] === '=' ? eq : !eq;
    }
    return false;
  });
}

// ── Configuration profiles (IoT Hub automatic device configurations) ──
// IoT Hub applies only the highest-priority configuration that targets a device,
// so the profiles below are written to target separate groups, plus one pilot that wins.
const STAFF = USERS.map((u) => u.name);
export const CONFIG_PROFILES: ConfigProfile[] = [
  {
    id: 'trackers-enterprise', name: 'Enterprise trackers',
    description: 'Fast reporting and CAN data for Enterprise fleets.',
    targetCondition: "tags.package='Enterprise' AND tags.deviceType IN ['FMC130','FMC650']",
    priority: 30,
    desired: { reportIntervalMovingSec: 15, reportIntervalStoppedSec: 300, overspeedKmh: 110, harshEventSensitivity: 'high', canBusEnabled: true, firmware: '03.29.00.Rev.13' },
    createdAt: minsAgo(60 * 24 * 120), updatedAt: minsAgo(60 * 24 * 9), createdBy: STAFF[0], status: 'Active',
  },
  {
    id: 'trackers-advance', name: 'Advance trackers',
    description: '30 s while moving; driver-behaviour events on.',
    targetCondition: "tags.package='Advance' AND tags.deviceType IN ['FMC130','FMC650']",
    priority: 20,
    desired: { reportIntervalMovingSec: 30, reportIntervalStoppedSec: 600, overspeedKmh: 120, harshEventSensitivity: 'medium', canBusEnabled: true, firmware: '03.28.07.Rev.02' },
    createdAt: minsAgo(60 * 24 * 200), updatedAt: minsAgo(60 * 24 * 2), createdBy: STAFF[3], status: 'Active',
  },
  {
    id: 'trackers-basic', name: 'Basic trackers',
    description: 'Position every minute; no CAN data.',
    targetCondition: "tags.package='Basic'",
    priority: 10,
    desired: { reportIntervalMovingSec: 60, reportIntervalStoppedSec: 1800, overspeedKmh: 120, harshEventSensitivity: 'low', canBusEnabled: false, firmware: '03.28.07.Rev.02' },
    createdAt: minsAgo(60 * 24 * 240), updatedAt: minsAgo(60 * 24 * 40), createdBy: STAFF[3], status: 'Active',
  },
  {
    id: 'plug-and-go', name: 'Plug & Go power saving',
    description: 'OBD trackers sleep after 5 min stopped to protect the car battery.',
    targetCondition: "tags.package='Plug & Go'",
    priority: 10,
    desired: { reportIntervalMovingSec: 60, reportIntervalStoppedSec: 3600, overspeedKmh: 130, harshEventSensitivity: 'low', canBusEnabled: false, firmware: '03.27.14.Rev.05' },
    createdAt: minsAgo(60 * 24 * 300), updatedAt: minsAgo(60 * 24 * 60), createdBy: STAFF[6], status: 'Active',
  },
  {
    id: 'dashcams', name: 'Dashcams',
    description: '1080p, 20 s event clips, cabin audio off.',
    targetCondition: "tags.deviceType IN ['JC400 dashcam','EH3T dual-channel','Howen Hero-ME41']",
    priority: 15,
    desired: { videoResolution: '1080p', eventClipSeconds: 20, audioRecording: false, firmware: '2.4.11' },
    createdAt: minsAgo(60 * 24 * 150), updatedAt: minsAgo(60 * 24 * 21), createdBy: STAFF[3], status: 'Active',
  },
  {
    id: 'pilot-fw-0329', name: 'Pilot: firmware 03.29.00.Rev.13',
    description: 'Tries the new firmware on Ravi Rentals before it goes to every Advance fleet.',
    targetCondition: "tags.package='Advance' AND tags.customerId='117' AND tags.deviceType IN ['FMC130','FMC650']",
    priority: 50,
    desired: { reportIntervalMovingSec: 30, reportIntervalStoppedSec: 600, overspeedKmh: 120, harshEventSensitivity: 'medium', canBusEnabled: true, firmware: '03.29.00.Rev.13' },
    createdAt: minsAgo(60 * 26), updatedAt: minsAgo(60 * 26), createdBy: STAFF[0], status: 'Active',
  },
  {
    id: 'cold-chain-temp', name: 'Cold chain temperature',
    description: 'Temperature every 60 s for refrigerated trucks. Not started yet.',
    targetCondition: "tags.package='Advance' AND tags.useCase='Cold Chain Monitoring' AND tags.deviceType IN ['FMC130','FMC650']",
    priority: 40,
    desired: { reportIntervalMovingSec: 30, reportIntervalStoppedSec: 60, temperatureIntervalSec: 60, temperatureAlarmC: 8, firmware: '03.28.07.Rev.02' },
    createdAt: minsAgo(60 * 3), updatedAt: minsAgo(60 * 3), createdBy: STAFF[1], status: 'Draft',
  },
];

// ── Device identities, twins and connection state ─────────────
const typeOf = (d: Device) => DEVICE_TYPES.find((t) => t.id === d.typeId)!;
const customerOf = (d: Device) => CUSTOMERS.find((c) => c.id === d.customerId) ?? null;
const offlineVehicles = new Set(VEHICLES.filter((v) => v.state === 'Offline').map((v) => v.deviceId));

export function tagsOf(d: Device): DeviceTwin['tags'] & { useCase: string | null } {
  const c = customerOf(d);
  return {
    customerId: d.customerId,
    package: c?.package ?? (d.consumerId ? 'Plug & Go' : null),
    deviceType: typeOf(d).name,
    country: c?.countryCode ?? (d.consumerId ? 'QA' : null),
    useCase: c?.useCase ?? null,
  };
}

/** The active profile that wins for these tags (highest priority), or null. */
export function winningProfile(tags: Record<string, unknown>, profiles = CONFIG_PROFILES): ConfigProfile | null {
  return (
    profiles
      .filter((p) => p.status === 'Active' && matchesTarget(p.targetCondition, { ...tags, customerId: tags['customerId'] == null ? '' : String(tags['customerId']) }))
      // IoT Hub applies the highest priority; on a tie, the most recently created configuration wins.
      .sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

export const IOT_STATES: IotDeviceState[] = [];
export const TWINS: DeviceTwin[] = [];

for (const d of DEVICES) {
  const t = typeOf(d);
  let registration: IotRegistration;
  if (d.status === 'Deactivated') registration = 'Disabled';
  else if (d.status === 'Available') registration = rand() < 0.65 ? 'Awaiting first connection' : 'Registered';
  else if (d.status === 'Allocated') registration = rand() < 0.7 ? 'Awaiting first connection' : 'Registered';
  else registration = rand() < 0.006 ? 'Attestation failed' : 'Registered';

  const live = d.status === 'Sold' && registration === 'Registered';
  const offline = !live || offlineVehicles.has(d.id) || (d.status === 'Faulty') || rand() < 0.05;
  const connected = live && !offline;
  const transport: IotTransport =
    t.category === 'Dashcam' ? 'Gateway · JT/T 808' : (t.name === 'FMC130' || t.name === 'FMC650') && rand() < 0.35 ? 'MQTT (direct)' : 'Gateway · Codec 8E';
  const neverSeen = registration === 'Awaiting first connection' || registration === 'Attestation failed';
  const lastActivity = neverSeen ? null : connected ? minsAgo(int(0, 2)) : d.lastSeen ?? minsAgo(int(60 * 26, 60 * 24 * 9));
  const moving = connected && rand() < 0.55;

  IOT_STATES.push({
    deviceId: d.id,
    hubName: HUB_NAME,
    registration,
    connection: connected ? 'Connected' : 'Disconnected',
    lastActivity,
    connectedSince: connected ? minsAgo(int(20, 60 * 30)) : null,
    transport,
    // Authentication follows the DPS enrollment group of the device type.
    auth: t.name === 'FMC130' || t.name === 'FMC650' ? 'X.509 CA' : 'Symmetric key',
    enrollmentGroup: `eg-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    // Messages since midnight (09:30 now): moving ≈ every 30 s, parked ≈ every 10 min, dashcams events only.
    messagesToday: connected ? (t.category === 'Dashcam' ? int(20, 90) : moving ? int(900, 1150) : int(50, 120)) : neverSeen ? 0 : int(0, 40),
    c2dQueued: !connected && !neverSeen && rand() < 0.15 ? int(1, 3) : 0,
  });

  // Twin: desired comes from the winning profile; reported matches it unless the device is
  // offline (pending) or rejected the change (error).
  const tags = tagsOf(d);
  const profile = winningProfile(tags);
  const desired: Record<string, TwinValue> = profile ? { ...profile.desired, $profile: profile.id } : {};
  const r = rand();
  const state: 'applied' | 'pending' | 'error' = !profile ? 'applied' : !connected ? (neverSeen ? 'pending' : r < 0.5 ? 'pending' : 'applied') : r < 0.05 ? 'pending' : r < 0.07 ? 'error' : 'applied';
  const reportedProps: Record<string, TwinValue> = {};
  if (!neverSeen) {
    for (const [k, v] of Object.entries(desired)) {
      if (k.startsWith('$')) continue;
      reportedProps[k] = state === 'applied' ? v : k === 'firmware' ? (t.category === 'Dashcam' ? '2.4.09' : '03.27.14.Rev.05') : k === 'reportIntervalMovingSec' ? 60 : v;
    }
    if (state === 'error') reportedProps['$configError'] = t.category === 'Dashcam' ? 'SD card not writable' : 'Parameter 10050 rejected by firmware 03.27';
    Object.assign(reportedProps, t.category === 'Dashcam'
      ? { storage: rand() < 0.9 ? 'OK' : 'Card full', cameraChannels: t.name.includes('dual') ? 2 : 1 }
      : { gsmSignal: int(2, 5), extVoltage: +(rand() < 0.6 ? 12 + rand() * 1.8 : 24 + rand() * 3.2).toFixed(2), batteryVoltage: +(3.9 + rand() * 0.3).toFixed(2), gnssFix: connected, ignition: moving });
    reportedProps['iccid'] = d.simSn;
  }
  const desiredVersion = profile ? int(3, 14) : 1;
  TWINS.push({
    deviceId: d.id,
    etag: `AAAAA${hex(5).toUpperCase()}=`,
    tags,
    desired: { version: desiredVersion, props: desired, updatedAt: profile?.updatedAt ?? d.createdAt },
    reported: neverSeen
      ? { version: 1, props: {}, updatedAt: null }
      : { version: desiredVersion * 3 + int(0, 40), props: reportedProps, updatedAt: state === 'applied' ? lastActivity : profile?.updatedAt ?? lastActivity },
  });
}

/** Whether a twin's reported state has caught up with what the portal asked for. */
export function twinSync(t: DeviceTwin): 'In sync' | 'Pending' | 'Error' | 'Not configured' {
  const keys = Object.keys(t.desired.props).filter((k) => !k.startsWith('$'));
  if (!keys.length) return 'Not configured';
  if (t.reported.props['$configError']) return 'Error';
  return keys.every((k) => t.reported.props[k] === t.desired.props[k]) ? 'In sync' : 'Pending';
}

// ── DPS enrollment groups ─────────────────────────────────────
export const ENROLLMENT_GROUPS: EnrollmentGroup[] = DEVICE_TYPES.map((t, i) => ({
  id: `eg-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  deviceTypeId: t.id,
  attestation: t.name === 'FMC130' || t.name === 'FMC650' ? 'X.509 CA' : 'Symmetric key',
  allocation: `Static · ${HUB_NAME} (UAE North)`,
  initialTwinTags: { deviceType: t.name },
  enabled: t.name !== 'FMB920',
  createdAt: minsAgo(60 * 24 * (400 - i * 30)),
}));

// ── Command history (direct methods, C2D, twin updates) ───────
const METHODS: { method: string; kind: CommandRecord['kind']; payload: Record<string, TwinValue>; ok: string }[] = [
  { method: 'getgps', kind: 'Direct method', payload: {}, ok: 'GPS:1 Sat:11 Lat:25.2048 Long:55.2708 Alt:12 Speed:0' },
  { method: 'beep', kind: 'Direct method', payload: { durationSec: 3 }, ok: 'Buzzer ON for 3 s' },
  { method: 'cpureset', kind: 'Direct method', payload: {}, ok: 'Rebooting' },
  { method: 'setdigout', kind: 'Direct method', payload: { output: 1, state: 1 }, ok: 'DOUT1:1 Timeout:INFINITY' },
  { method: 'getinfo', kind: 'Direct method', payload: {}, ok: 'INI:2026/10/12 08:14 RTC:2026/11/02 09:12 RST:2 ERR:0' },
  { method: 'setparam', kind: 'C2D message', payload: { '10050': 30, '10150': 600 }, ok: 'New value 10050:30;10150:600' },
  { method: 'firmware', kind: 'Twin update', payload: { firmware: '03.29.00.Rev.13' }, ok: 'Reported firmware 03.29.00.Rev.13' },
];
const sold = DEVICES.filter((d) => d.status === 'Sold' || d.status === 'Faulty');
export const COMMANDS: CommandRecord[] = Array.from({ length: 84 }, (_, i) => {
  const d = pick(sold);
  const st = IOT_STATES.find((s) => s.deviceId === d.id)!;
  const m = typeOf(d).category === 'Dashcam' ? pick(METHODS.filter((x) => x.method === 'getinfo' || x.method === 'cpureset')) : pick(METHODS);
  const ago = i < 4 ? int(1, 40) : int(60, 60 * 24 * 14);
  const r = rand();
  let status: CommandStatus;
  if (m.kind === 'C2D message' && st.connection === 'Disconnected' && ago < 60 * 48) status = 'Queued';
  else if (st.connection === 'Disconnected' && m.kind === 'Direct method' && r < 0.6) status = 'Timed out';
  else status = r < 0.9 ? 'Succeeded' : r < 0.96 ? 'Failed' : 'Timed out';
  const latency = status === 'Succeeded' ? int(m.kind === 'Direct method' ? 380 : 900, m.kind === 'Direct method' ? 2600 : 9000) : status === 'Timed out' ? 30000 : status === 'Failed' ? int(400, 1500) : null;
  return {
    id: 1000 + i,
    deviceId: d.id,
    method: m.method,
    kind: m.kind,
    payload: m.payload,
    status,
    responseCode: status === 'Succeeded' ? 200 : status === 'Failed' ? pick([400, 404, 501]) : status === 'Timed out' ? 504 : null,
    response: status === 'Succeeded' ? m.ok : status === 'Failed' ? pick(['Unknown command', 'Parameter out of range', 'Device busy']) : status === 'Timed out' ? 'Device did not respond within 30 s' : null,
    latencyMs: latency,
    sentAt: minsAgo(ago),
    sentBy: pick(STAFF.slice(0, 7)),
  };
}).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
// One Queued C2D record per message waiting on a device, so the queue and the log agree.
let cmdId = 2000;
for (const s of IOT_STATES) {
  for (let k = 0; k < s.c2dQueued; k++) {
    COMMANDS.push({
      id: cmdId++, deviceId: s.deviceId, method: 'setparam', kind: 'C2D message', payload: { '10050': 30, '10150': 600 },
      status: 'Queued', responseCode: null, response: 'Queued until the device reconnects (expires in 48 h)', latencyMs: null,
      sentAt: minsAgo(int(30, 60 * 40)), sentBy: pick(STAFF.slice(0, 7)),
    });
  }
}
COMMANDS.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

// ── Hub metrics: one source of truth for "messages today" ─────
const today = IOT_STATES.reduce((a, s) => a + s.messagesToday, 0);
const hoursToday = hubHours(TODAY) + hubMinutes(TODAY) / 60; // 9.5, UAE time
// A day curve: quiet at night, peaks at the morning and evening rush.
const curve = (h: number) => 0.25 + Math.max(0, Math.sin(((h - 5) / 17) * Math.PI)) + (h >= 7 && h <= 9 ? 0.35 : 0) + (h >= 17 && h <= 19 ? 0.3 : 0);
const hours = Array.from({ length: 24 }, (_, i) => (hubHours(TODAY) - 23 + i + 24) % 24);
// The current hour is only partly over, so it carries only that share of a full hour's weight.
const partial = hoursToday % 1 || 1;
const w = (i: number) => curve(hours[i]) * (i === 23 ? partial : 1);
const todayIdx = hours.map((h, i) => (i >= 24 - Math.ceil(hoursToday) ? i : -1)).filter((i) => i >= 0);
const todayWeight = todayIdx.reduce((a, i) => a + w(i), 0);
const perWeight = today / todayWeight;
const mph = hours.map((_, i) => Math.round(w(i) * perWeight * (0.92 + rand() * 0.16)));
// Make today's hours add up exactly to the devices' own counts.
const diff = today - todayIdx.reduce((a, i) => a + mph[i], 0);
mph[23] += diff;
const projected = Math.round((today / hoursToday) * 24);
const units = Math.max(1, Math.ceil((projected * 1.4) / 400000));

export const HUB_METRICS: HubMetrics = {
  hubName: HUB_NAME,
  region: 'UAE North',
  tier: 'S1',
  units,
  dailyQuota: units * 400000,
  messagesPerHour: mph,
  throttledToday: 0,
  routes: [
    { name: 'telemetry-to-stream', endpoint: 'Event Hubs · hn-telemetry (live map stream)', source: 'Device telemetry', condition: 'true', healthy: true },
    { name: 'archive-raw', endpoint: 'Blob storage · iot-raw/{iothub}/{YYYY}/{MM}/{DD}', source: 'Device telemetry', condition: 'true', healthy: true },
    { name: 'lifecycle-to-django', endpoint: 'Event Grid · portal webhook /api/iot/events', source: 'Connection state, lifecycle', condition: 'true', healthy: true },
    { name: 'twin-changes', endpoint: 'Service Bus · twin-changes', source: 'Twin change events', condition: "$body.properties.reported.$configError != null", healthy: false },
  ],
};

// ── Connection and lifecycle events, last 24 h ────────────────
export const CONNECTION_EVENTS: ConnectionEvent[] = [];
for (const s of IOT_STATES) {
  if (s.connection === 'Connected' && s.connectedSince && new Date(s.connectedSince) > new Date(minsAgo(60 * 24))) {
    CONNECTION_EVENTS.push({ at: s.connectedSince, deviceId: s.deviceId, type: 'Connected', detail: `${s.transport} · ${s.auth}` });
  }
  if (s.connection === 'Disconnected' && s.lastActivity && new Date(s.lastActivity) > new Date(minsAgo(60 * 24))) {
    CONNECTION_EVENTS.push({ at: s.lastActivity, deviceId: s.deviceId, type: 'Disconnected', detail: pick(['MQTT keep-alive timed out', 'Gateway session closed', 'Network unreachable']) });
  }
}
for (const t of TWINS.filter((x) => x.desired.updatedAt > minsAgo(60 * 24)).slice(0, 12)) {
  CONNECTION_EVENTS.push({ at: t.desired.updatedAt, deviceId: t.deviceId, type: 'Twin changed', detail: `Desired properties set by profile ${String(t.desired.props['$profile'] ?? '')}` });
}
CONNECTION_EVENTS.sort((a, b) => b.at.localeCompare(a.at));

console.assert(
  HUB_METRICS.messagesPerHour.slice(24 - Math.ceil(hoursToday)).reduce((a, b) => a + b, 0) === today,
  "hourly messages for today must add up to the devices' messagesToday",
);
