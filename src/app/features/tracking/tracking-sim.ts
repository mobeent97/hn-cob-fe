import { Vehicle } from '../../core/data/models';

export type VehicleState = Vehicle['state'];
export type StateFilter = 'all' | VehicleState;
/** A vehicle plus the heading the simulation steers it along. */
export interface LiveVehicle extends Vehicle {
  heading: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 09:30:05 */
export const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Relative to the simulated clock, down to seconds for live rows. */
export function relTime(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * One tick of sample movement. Moving vehicles advance along their heading (scaled up so
 * the motion reads at city zoom), wander a little and change speed; idle ones re-report.
 * A few change state so the counts stay alive. Offline vehicles stay silent.
 */
export function simulateStep(vs: LiveVehicle[], now: number, tickMs: number): LiveVehicle[] {
  const stamp = new Date(now).toISOString();
  return vs.map((v) => {
    if (v.state === 'Offline') return v;
    if (v.state === 'Idle') {
      if (Math.random() < 0.04) return { ...v, state: 'Moving', speedKmh: Math.round(rnd(18, 40)), ignition: true, updatedAt: stamp };
      return { ...v, updatedAt: stamp };
    }
    if (Math.random() < 0.02) return { ...v, state: 'Idle', speedKmh: 0, updatedAt: stamp };
    const km = ((v.speedKmh * tickMs) / 3_600_000) * 4;
    const heading = (v.heading + rnd(-14, 14) + 360) % 360;
    const rad = (heading * Math.PI) / 180;
    const dLat = (km * Math.cos(rad)) / 111;
    const dLng = (km * Math.sin(rad)) / (111 * Math.cos((v.lat * Math.PI) / 180));
    return {
      ...v,
      heading,
      lat: v.lat + dLat,
      lng: v.lng + dLng,
      speedKmh: Math.round(Math.max(12, Math.min(120, v.speedKmh + rnd(-8, 8)))),
      updatedAt: stamp,
    };
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TONE: Record<VehicleState, string> = { Moving: 'positive', Idle: 'warning', Offline: '' };

/** The popup card. MapLibre takes an HTML string; every value is escaped. */
export function popupHtml(v: LiveVehicle, customer: string, updated: string, colour: string) {
  const speed = v.state === 'Offline' ? '<span class="dash">—</span>' : `${v.speedKmh}<span class="unit">km/h</span>`;
  return `
    <div class="trk-pop">
      <div class="trk-pop-head">
        <span class="dot" style="color:${esc(colour)}"></span>
        <strong>${esc(v.plate)}</strong>
        <span class="pill ${TONE[v.state]}">${esc(v.state)}</span>
      </div>
      <p class="trk-pop-sub">${esc(v.driver)} · ${esc(customer)}</p>
      <dl>
        <dt>Speed</dt><dd class="num">${speed}</dd>
        <dt>Ignition</dt><dd>${v.ignition ? 'On' : 'Off'}</dd>
        <dt>Updated</dt><dd class="num">${esc(updated)}</dd>
        <dt>Device</dt><dd class="mono">${esc(v.deviceId)}</dd>
      </dl>
    </div>`;
}
