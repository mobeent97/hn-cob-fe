import { Device, DeviceType } from '../../core/data/models';

/** Columns the bulk-upload CSV must have, in template order. */
export const IMPORT_COLUMNS = ['device_id', 'imei', 'type', 'sim_sn', 'msisdn'] as const;

export interface ImportRow {
  line: number;
  deviceId: string;
  imei: string;
  type: string;
  simSn: string;
  msisdn: string;
  typeId: number | null;
  errors: string[];
}

/** Field rules shared by the Add device dialog and the bulk upload. */
export const DEVICE_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/i;
export const IMEI_RE = /^\d{15}$/;
export const SIM_RE = /^\d{18,20}$/;
export const MSISDN_RE = /^\d{8,15}$/;

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Turns CSV text into validated rows. Returns a file-level error instead when the header
 * is missing a required column.
 */
export function validateImport(
  text: string,
  types: DeviceType[],
  existing: Device[],
): { rows: ImportRow[]; error: string | null } {
  const table = parseCsv(text.replace(/^﻿/, ''));
  if (!table.length) return { rows: [], error: 'The file is empty.' };
  const head = table[0].map((h) => h.trim().toLowerCase());
  const missing = IMPORT_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) return { rows: [], error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  const col = (r: string[], c: (typeof IMPORT_COLUMNS)[number]) => (r[head.indexOf(c)] ?? '').trim();

  const ids = new Set(existing.map((d) => d.id.toLowerCase()));
  const imeis = new Set(existing.map((d) => d.imei));
  const seenIds = new Set<string>();
  const seenImeis = new Set<string>();

  const rows = table.slice(1).map((r, i): ImportRow => {
    const row: ImportRow = {
      line: i + 2,
      deviceId: col(r, 'device_id').toUpperCase(),
      imei: col(r, 'imei'),
      type: col(r, 'type'),
      simSn: col(r, 'sim_sn'),
      msisdn: col(r, 'msisdn').replace(/^\+/, ''),
      typeId: null,
      errors: [],
    };
    const e = row.errors;
    if (!row.deviceId) e.push('Device ID is missing');
    else if (!DEVICE_ID_RE.test(row.deviceId)) e.push('Device ID: 3–20 letters, digits or dashes');
    else if (ids.has(row.deviceId.toLowerCase())) e.push('Device ID already in stock');
    else if (seenIds.has(row.deviceId.toLowerCase())) e.push('Device ID repeated in this file');

    if (!IMEI_RE.test(row.imei)) e.push('IMEI must be 15 digits');
    else if (imeis.has(row.imei)) e.push('IMEI already in stock');
    else if (seenImeis.has(row.imei)) e.push('IMEI repeated in this file');

    const t = types.find((x) => x.name.toLowerCase() === row.type.toLowerCase());
    if (!row.type) e.push('Type is missing');
    else if (!t) e.push(`Unknown type “${row.type}”`);
    else row.typeId = t.id;

    if (row.simSn && !SIM_RE.test(row.simSn)) e.push('SIM SN must be 18–20 digits');
    if (row.msisdn && !MSISDN_RE.test(row.msisdn)) e.push('MSISDN must be 8–15 digits');

    seenIds.add(row.deviceId.toLowerCase());
    seenImeis.add(row.imei);
    return row;
  });
  return { rows, error: rows.length ? null : 'The file has a header but no devices.' };
}

export const toDevice = (r: ImportRow, createdAt: string, orgId = 1): Device => ({
  orgId,
  id: r.deviceId,
  imei: r.imei,
  typeId: r.typeId!,
  customerId: null,
  consumerId: null,
  status: 'Available',
  simSn: r.simSn,
  msisdn: r.msisdn,
  createdAt,
  lastSeen: null,
  plate: null,
});
