import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { SettingsApi, settingsErrorKey, settingsPatch } from './settings.api';
import { fail, ok, setupHttp } from './testing';
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_SETTINGS } from '../data/reference';

const API = environment.apiUrl;
const SETTINGS = {
  password: { min_length: 12, require_number: true, require_symbol: false, expiry_days: 0, history: 3 },
  pagination: { page_size: 25 },
  login: { session_minutes: 30, max_attempts: 5, lock_minutes: 15 },
  updated_at: '2026-11-17T09:12:00Z',
  updated_by: { id: 1, full_name: 'Mobeen Tahir' },
};

describe('SettingsApi', () => {
  let api: SettingsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(SettingsApi);
  });
  afterEach(() => http.verify());

  it('reads the settings into the camelCase model (no one-time-code setting)', async () => {
    const done = api.get();
    http.expectOne(`${API}/settings/`).flush(ok(SETTINGS));
    const s = await done;
    expect(s.password).toEqual({ minLength: 12, requireNumber: true, requireSymbol: false, expiryDays: 0, history: 3 });
    expect(s.pagination.pageSize).toBe(25);
    expect(s.login).toEqual({ sessionMinutes: 30, maxAttempts: 5, lockMinutes: 15 });
    expect(s.updatedBy).toBe('Mobeen Tahir');
  });

  it('patches one section only', async () => {
    const body = settingsPatch('pagination', { ...DEFAULT_SETTINGS, pagination: { pageSize: 50 } });
    expect(body).toEqual({ pagination: { page_size: 50 } });
    const done = api.patch(body);
    const req = http.expectOne(`${API}/settings/`);
    expect(req.request.method).toBe('PATCH');
    req.flush(ok({ ...SETTINGS, pagination: { page_size: 50 } }, 4500));
    expect((await done).pagination.pageSize).toBe(50);
  });

  it('maps 400 4501 with field paths the screen can use', async () => {
    const done = api.patch({ password: { min_length: 4 } });
    http.expectOne(`${API}/settings/`).flush(fail(4501, 'Some values are out of range.', { errors: { 'password.min_length': ['Enter a whole number from 8 to 64.'] } }), { status: 400, statusText: 'Bad Request' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(4501);
    expect(err.field('password.min_length')).toBe('Enter a whole number from 8 to 64.');
    expect(settingsErrorKey('password.min_length')).toBe('password.minLength');
  });

  it('reads the public password policy', async () => {
    const done = api.passwordPolicy();
    http.expectOne(`${API}/settings/password-policy/`).flush(ok(SETTINGS.password));
    expect((await done).minLength).toBe(12);
  });

  it('round-trips notification preferences in snake_case', async () => {
    const done = api.savePreferences({ ...DEFAULT_NOTIFICATION_PREFS, quiet: null, timezone: 'Asia/Qatar' });
    const req = http.expectOne(`${API}/notifications/preferences/`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.channels.order).toEqual({ in_app: true, email: true });
    expect(req.request.body).toMatchObject({ digest: 'daily', quiet: null, timezone: 'Asia/Qatar' });
    req.flush(ok(req.request.body, 4503));
    expect((await done).channels.order).toEqual({ inApp: true, email: true });
  });
});
