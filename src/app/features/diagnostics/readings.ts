import { Device, DiagnosticParam } from '../../core/data/models';

/** One reading as the device reported it, already formatted for people. */
export interface Reading {
  param: DiagnosticParam;
  value: string | null;
  unit?: string;
  /** 0-5 when the reading is a signal-strength bar count. */
  bars?: number;
  tone?: 'positive' | 'warning' | 'negative' | '';
}

/** Seeded so a device returns stable values, and a refresh moves them slightly. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Sample readings for a device, keyed by the parameter's response key (Teltonika AVL IDs).
 * Design-phase stand-in for the diagnostics service's "read parameters" call.
 */
export function sampleReadings(device: Device, params: DiagnosticParam[], refresh: number): Reading[] {
  const base = seeded(hash(device.id));
  const jitter = seeded(hash(device.id) + refresh * 977);
  const ignition = base() > 0.35;
  const moving = ignition && jitter() > 0.4;
  const fmt2 = (n: number) => n.toFixed(2);

  return params.map((param): Reading => {
    switch (param.responseKey) {
      case 'io_239':
        return { param, value: ignition ? 'On' : 'Off', tone: ignition ? 'positive' : '' };
      case 'io_240':
        return { param, value: moving ? 'Moving' : 'Stationary' };
      case 'io_21': {
        const bars = Math.max(1, Math.min(5, Math.round(2 + base() * 3 + (jitter() - 0.5))));
        return { param, value: `${bars} of 5`, bars, tone: bars <= 1 ? 'negative' : bars === 2 ? 'warning' : '' };
      }
      case 'io_66': {
        const v = ignition ? 13.6 + base() * 0.8 + (jitter() - 0.5) * 0.1 : 12.1 + base() * 0.6;
        return { param, value: fmt2(v), unit: 'V', tone: v < 11.8 ? 'warning' : '' };
      }
      case 'io_67':
        return { param, value: fmt2(3.9 + base() * 0.25 + (jitter() - 0.5) * 0.02), unit: 'V' };
      case 'io_16': {
        const km = Math.round(18000 + base() * 240000 + refresh * (moving ? 0.4 : 0));
        return { param, value: km.toLocaleString('en-GB'), unit: 'km' };
      }
      case 'io_36': {
        const rpm = !ignition ? 0 : moving ? Math.round(1300 + jitter() * 1200) : Math.round(680 + jitter() * 120);
        return { param, value: rpm.toLocaleString('en-GB'), unit: 'rpm' };
      }
      case 'io_89':
        return { param, value: String(Math.round(18 + base() * 78)), unit: '%' };
      case 'sd_state': {
        const used = 8 + base() * 54;
        return { param, value: `OK · ${used.toFixed(1)} of 64`, unit: 'GB', tone: 'positive' };
      }
      default:
        return { param, value: null };
    }
  });
}
