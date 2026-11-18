import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { NotificationCode, NotificationDto, NotificationsApi, isStaleSync } from './notifications.api';
import { fail, ok, setupHttp } from './testing';

const API = environment.apiUrl;
const DTO: NotificationDto = {
  id: 981,
  kind: 'deletion',
  title: 'Deletion request needs approval',
  body: 'A user in Vodafone Qatar is waiting for your approval.',
  link: '/audit?request=42',
  organization: { id: 3, name: 'Vodafone Qatar' },
  read: false,
  read_at: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
};

describe('NotificationsApi', () => {
  let api: NotificationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(NotificationsApi);
  });
  afterEach(() => http.verify());

  it('reads the first page with its counts, by_kind and sync token, mapping rows to the model', async () => {
    const done = api.list({ limit: 20, unread: true, kind: 'deletion', organization: 3 });
    const req = http.expectOne((r) => r.url === `${API}/notifications/`);
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('unread')).toBe('true');
    expect(req.request.params.get('kind')).toBe('deletion');
    expect(req.request.params.get('organization')).toBe('3');
    expect(req.request.params.has('cursor')).toBe(false);
    req.flush(ok({ results: [DTO], next_cursor: 'abc', count: 31, counts: { all: 40, unread: 31 }, by_kind: { deletion: 31 }, sync_token: 'tok' }));
    const page = await done;
    expect(page.results[0]).toEqual({
      id: 981, orgId: 3, orgName: 'Vodafone Qatar', at: '2026-11-18T09:00:00Z', kind: 'deletion',
      title: 'Deletion request needs approval', body: 'A user in Vodafone Qatar is waiting for your approval.',
      link: '/audit?request=42', read: false,
    });
    expect(page).toMatchObject({ nextCursor: 'abc', count: 31, counts: { all: 40, unread: 31 }, byKind: { deletion: 31 }, syncToken: 'tok' });
  });

  it('passes the cursor for later pages and never sends empty filters', async () => {
    const done = api.list({ limit: 20, cursor: 'abc', unread: false, kind: null, organization: null });
    const req = http.expectOne((r) => r.url === `${API}/notifications/`);
    expect(req.request.params.keys().sort()).toEqual(['cursor', 'limit']);
    req.flush(ok({ results: [{ ...DTO, organization: null, link: 'https://evil.example' }], next_cursor: null, count: 21 }));
    const page = await done;
    expect(page.results[0].orgId).toBeNull();
    expect(page.results[0].link).toBe('/notifications');
    expect(page.counts).toBeNull();
    expect(page.nextCursor).toBeNull();
  });

  it('syncs since a token', async () => {
    const done = api.sync('tok', 500);
    const req = http.expectOne((r) => r.url === `${API}/notifications/sync/`);
    expect(req.request.params.get('since')).toBe('tok');
    expect(req.request.params.get('limit')).toBe('500');
    req.flush(ok({ changed: [DTO], deleted_ids: [5], unread: 3, sync_token: 'tok2', has_more: false }));
    expect(await done).toMatchObject({ deletedIds: [5], unread: 3, syncToken: 'tok2', hasMore: false });
  });

  it('maps a 410 4715 to an ApiError that isStaleSync recognises', async () => {
    const done = api.sync('old');
    http.expectOne((r) => r.url === `${API}/notifications/sync/`)
      .flush(fail(4715, 'Your notifications are out of date. Reload them.'), { status: 410, statusText: 'Gone' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(NotificationCode.Stale);
    expect(err.message).toBe('Your notifications are out of date. Reload them.');
    expect(isStaleSync(err)).toBe(true);
  });

  it('marks read and unread, one or many, and all', async () => {
    const one = api.setRead(981, true);
    const r1 = http.expectOne(`${API}/notifications/981/`);
    expect(r1.request.method).toBe('PATCH');
    expect(r1.request.body).toEqual({ read: true });
    r1.flush(ok({ ...DTO, read: true, read_at: '2026-11-18T10:00:00Z' }, 4710));
    expect((await one).read).toBe(true);

    const many = api.setReadMany([1, 2], false);
    const r2 = http.expectOne(`${API}/notifications/read/`);
    expect(r2.request.body).toEqual({ ids: [1, 2], read: false });
    r2.flush(ok({ updated: 2, unread: 7 }, 4711));
    expect(await many).toEqual({ updated: 2, unread: 7 });

    const all = api.readAll();
    const r3 = http.expectOne(`${API}/notifications/read-all/`);
    expect(r3.request.body).toEqual({});
    r3.flush(ok({ updated: 2, ids: [3, 4], unread: 0 }, 4712));
    expect((await all).ids).toEqual([3, 4]);

    const kind = api.readAll('order');
    http.expectOne(`${API}/notifications/read-all/`).flush(ok({ updated: 0, ids: [], unread: 0 }, 4712));
    await kind;
  });

  it('deletes and restores by ids', async () => {
    const del = api.remove([1, 2]);
    const r1 = http.expectOne(`${API}/notifications/delete/`);
    expect(r1.request.method).toBe('POST');
    expect(r1.request.body).toEqual({ ids: [1, 2] });
    r1.flush(ok({ deleted: 2, unread: 4 }, 4713));
    expect(await del).toEqual({ deleted: 2, unread: 4 });

    const back = api.restore([1, 2]);
    const r2 = http.expectOne(`${API}/notifications/restore/`);
    expect(r2.request.body).toEqual({ ids: [1, 2] });
    r2.flush(ok({ restored: 2, unread: 6 }, 4714));
    expect(await back).toEqual({ restored: 2, unread: 6 });
  });

  it('reads the unread count', async () => {
    const done = api.unreadCount();
    http.expectOne(`${API}/notifications/unread-count/`).flush(ok({ unread: 12 }));
    expect(await done).toBe(12);
  });

  it('maps a 404 4008 to an ApiError with the server message', async () => {
    const done = api.setRead(5, true);
    http.expectOne(`${API}/notifications/5/`).flush(fail(4008, 'Not found.'), { status: 404, statusText: 'Not Found' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.httpStatus).toBe(404);
    expect(err.message).toBe('Not found.');
    expect(isStaleSync(err)).toBe(false);
  });

  describe('push devices', () => {
    it('reads the push config', async () => {
      const done = api.pushConfig();
      http.expectOne(`${API}/notifications/push/config/`).flush(ok({ enabled: false, vapid_key: null, web_config: null }));
      expect((await done).enabled).toBe(false);
    });

    it('registers a token and keeps the server message for the toast', async () => {
      const body = { token: 'fcm-token-abcdefghijklmnop', platform: 'web' as const, app_id: 'localhost:4200', locale: 'en', label: 'Chrome on Linux' };
      const done = api.registerToken(body);
      const req = http.expectOne(`${API}/notifications/push/tokens/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      req.flush(ok({ id: 1, platform: 'web', app_id: 'localhost:4200', app_version: '', locale: 'en', label: 'Chrome on Linux', created_at: '', last_seen_at: '' }, 4700, 'Notifications are on for this device.'), { status: 201, statusText: 'Created' });
      const res = await done;
      expect(res.message).toBe('Notifications are on for this device.');
      expect(res.data.id).toBe(1);
    });

    it('maps 503 4703 when push is not configured', async () => {
      const done = api.registerToken({ token: 'fcm-token-abcdefghijklmnop', platform: 'web' });
      http.expectOne(`${API}/notifications/push/tokens/`)
        .flush(fail(4703, "Push notifications aren't available on this portal."), { status: 503, statusText: 'Unavailable' });
      const err = await done.catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe(NotificationCode.PushUnavailable);
      expect(err.message).toBe("Push notifications aren't available on this portal.");
    });

    it('unregisters a token', async () => {
      const done = api.unregisterToken('fcm-token-abcdefghijklmnop');
      const req = http.expectOne(`${API}/notifications/push/tokens/unregister/`);
      expect(req.request.body).toEqual({ token: 'fcm-token-abcdefghijklmnop' });
      req.flush(ok(null, 4701, 'Notifications are off for this device.'));
      expect(await done).toBe('Notifications are off for this device.');
    });

    it('sends a test push and maps 429 4705', async () => {
      const done = api.testPush('web');
      const req = http.expectOne(`${API}/notifications/push/test/`);
      expect(req.request.body).toEqual({ platform: 'web' });
      req.flush(ok({ sent: 1, failed: 0 }, 4702, 'Test notification sent.'));
      expect((await done).data).toEqual({ sent: 1, failed: 0 });

      const again = api.testPush('web');
      http.expectOne(`${API}/notifications/push/test/`)
        .flush(fail(4705, 'Wait a moment before sending another test notification.'), { status: 429, statusText: 'Too Many' });
      const err = await again.catch((e) => e);
      expect(err.code).toBe(NotificationCode.TestThrottled);
    });
  });
});
