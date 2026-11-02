// Helpers shared by the customer wizard, the customer detail screen and the consumer list.
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { TODAY } from '../../core/data/mock-db';

export const DOC_KINDS = ['Trade licence', 'Contract', 'ID copy', 'Passport', 'Other'] as const;
export const USER_GROUP_OPTIONS = ['Customer admin', 'Fleet manager', 'Dispatcher', 'Read only'];
export const BRAND_SWATCHES = ['#0a6f96', '#1e7b4f', '#a86f0c', '#7a1f2b', '#22313f', '#00695c', '#3d4a56', '#b4441b'];

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const PHONE_RE = /^[0-9][0-9 ]{6,14}$/;
export const URL_RE = /^https?:\/\/[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i;
export const QID_RE = /^[A-Za-z0-9-]{6,20}$/;
export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** "+971 50 123 4567" → { dial: '+971', number: '50 123 4567' } */
export function splitPhone(phone: string, fallbackDial = '+971') {
  const m = /^(\+\d{1,4})\s*(.*)$/.exec(phone.trim());
  return m ? { dial: m[1], number: m[2] } : { dial: fallbackDial, number: phone };
}

/** ISO date (yyyy-mm-dd) of the sample data's "today", plus n days. */
export const isoDay = (plusDays = 0) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + plusDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Required that also rejects whitespace-only input (the legacy forms let "   " through). */
export const notBlank: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  typeof c.value === 'string' && c.value.length && !c.value.trim() ? { required: true } : null;

/** Date on or after today. */
export const notPast: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  c.value && c.value < isoDay() ? { past: true } : null;

/** One message per control, in the order a person would fix them. */
export function messageFor(c: AbstractControl, label: string, patternHint?: string): string | null {
  const e = c.errors;
  if (!e) return null;
  if (e['required']) return `Enter ${label}.`;
  if (e['maxlength']) return `Keep it under ${e['maxlength'].requiredLength} characters.`;
  if (e['past']) return 'Pick today or a later date.';
  if (e['taken']) return e['taken'];
  if (e['pattern']) return patternHint ?? `Check the ${label}.`;
  return `Check the ${label}.`;
}

export const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`);
