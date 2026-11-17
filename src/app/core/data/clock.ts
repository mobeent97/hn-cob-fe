// Time helpers. The portal runs on UAE time (UTC+4); clock maths uses this, never the browser's zone.

/** When the app loaded. Screens use it as "today" for relative dates and windows. */
export const TODAY = new Date();
export const HUB_UTC_OFFSET = 4;
export const hubHours = (d: Date) => (d.getUTCHours() + HUB_UTC_OFFSET) % 24;
export const hubMinutes = (d: Date) => d.getUTCMinutes();
/** Current time as ISO 8601, for stamping new records. */
export const nowIso = () => new Date().toISOString();
