import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope } from '../auth/auth.models';
import { NotificationKind, NotificationPrefs, PortalSettings } from '../data/models';
import { apiUrl, unwrap } from './api-client';

/** Settings API v1: portal settings and the signed-in user's notification preferences (SETTINGS_API.md). */

export interface PasswordPolicyDto {
  min_length: number;
  require_number: boolean;
  require_symbol: boolean;
  expiry_days: number;
  history: number;
}

export interface SettingsDto {
  password: PasswordPolicyDto;
  pagination: { page_size: number };
  login: { session_minutes: number; max_attempts: number; lock_minutes: number };
  updated_at: string | null;
  updated_by: { id: number; full_name: string } | null;
}

export interface SettingsPatch {
  password?: Partial<PasswordPolicyDto>;
  pagination?: { page_size?: number };
  login?: Partial<SettingsDto['login']>;
}

export interface NotificationPrefsDto {
  channels: Record<NotificationKind, { in_app: boolean; email: boolean }>;
  digest: 'off' | 'daily' | 'weekly';
  quiet: { from: string; to: string } | null;
  timezone: string;
}

export const SettingsCode = { Saved: 4500, OutOfRange: 4501, PrefsSaved: 4503, QuietInvalid: 4504 } as const;

export const toPolicy = (p: PasswordPolicyDto): PortalSettings['password'] => ({
  minLength: p.min_length, requireNumber: p.require_number, requireSymbol: p.require_symbol, expiryDays: p.expiry_days, history: p.history,
});

export function toSettings(d: SettingsDto): PortalSettings {
  return {
    password: toPolicy(d.password),
    pagination: { pageSize: d.pagination.page_size },
    login: { sessionMinutes: d.login.session_minutes, maxAttempts: d.login.max_attempts, lockMinutes: d.login.lock_minutes },
    updatedAt: d.updated_at,
    updatedBy: d.updated_by?.full_name ?? null,
  };
}

/** One section of the screen's model → the PATCH body for that section only. */
export function settingsPatch(section: 'password' | 'pagination' | 'login', s: PortalSettings): SettingsPatch {
  if (section === 'password') {
    const p = s.password;
    return { password: { min_length: p.minLength, require_number: p.requireNumber, require_symbol: p.requireSymbol, expiry_days: p.expiryDays, history: p.history } };
  }
  if (section === 'pagination') return { pagination: { page_size: s.pagination.pageSize } };
  const l = s.login;
  return { login: { session_minutes: l.sessionMinutes, max_attempts: l.maxAttempts, lock_minutes: l.lockMinutes } };
}

/** Field paths in `data.errors` (`password.min_length`) → the screen's keys (`password.minLength`). */
export function settingsErrorKey(path: string): string {
  const [sec, field] = path.split('.');
  return `${sec}.${(field ?? '').replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}

export function toPrefs(d: NotificationPrefsDto): NotificationPrefs {
  const channels = {} as NotificationPrefs['channels'];
  for (const [k, v] of Object.entries(d.channels) as [NotificationKind, { in_app: boolean; email: boolean }][]) {
    channels[k] = { inApp: v.in_app, email: v.email };
  }
  return { channels, digest: d.digest, quiet: d.quiet ? { ...d.quiet } : null, timezone: d.timezone };
}

export function fromPrefs(p: NotificationPrefs): NotificationPrefsDto {
  const channels = {} as NotificationPrefsDto['channels'];
  for (const [k, v] of Object.entries(p.channels) as [NotificationKind, { inApp: boolean; email: boolean }][]) {
    channels[k] = { in_app: v.inApp, email: v.email };
  }
  return { channels, digest: p.digest, quiet: p.quiet ? { ...p.quiet } : null, timezone: p.timezone };
}

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);

  async get(): Promise<PortalSettings> {
    return toSettings(await unwrap(this.http.get<ApiEnvelope<SettingsDto>>(apiUrl('/settings/'))));
  }

  /** Partial update; returns the full settings. */
  async patch(body: SettingsPatch): Promise<PortalSettings> {
    return toSettings(await unwrap(this.http.patch<ApiEnvelope<SettingsDto>>(apiUrl('/settings/'), body)));
  }

  /** Public (no token): the rules list on the reset and set-password screens. */
  async passwordPolicy(): Promise<PortalSettings['password']> {
    return toPolicy(await unwrap(this.http.get<ApiEnvelope<PasswordPolicyDto>>(apiUrl('/settings/password-policy/'))));
  }

  async preferences(): Promise<NotificationPrefs> {
    return toPrefs(await unwrap(this.http.get<ApiEnvelope<NotificationPrefsDto>>(apiUrl('/notifications/preferences/'))));
  }

  async savePreferences(p: NotificationPrefs): Promise<NotificationPrefs> {
    return toPrefs(await unwrap(this.http.put<ApiEnvelope<NotificationPrefsDto>>(apiUrl('/notifications/preferences/'), fromPrefs(p))));
  }
}
