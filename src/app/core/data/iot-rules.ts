// IoT Hub rules the portal applies on the client (pure functions, no data).
import { DeviceTwin } from './models';

/** IoT Hub this environment manages. TODO: read from GET /iot/hub/ once the Device management API exists. */
export const HUB_NAME = 'hn-fleet-hub-dev';

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

/** Whether a twin's reported state has caught up with what the portal asked for. */
export function twinSync(t: DeviceTwin): 'In sync' | 'Pending' | 'Error' | 'Not configured' {
  const keys = Object.keys(t.desired.props).filter((k) => !k.startsWith('$'));
  if (!keys.length) return 'Not configured';
  if (t.reported.props['$configError']) return 'Error';
  return keys.every((k) => t.reported.props[k] === t.desired.props[k]) ? 'In sync' : 'Pending';
}
