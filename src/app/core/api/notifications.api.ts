import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { AppNotification, NotificationKind } from '../data/models';
import { routeOf } from '../notifications/link';
import { apiUrl, query, toApiError, unwrap } from './api-client';

/** Notifications feed and push devices v1 (hn-cob-be/docs/PUSH_NOTIFICATIONS.md section 4). */

export const NotificationCode = {
  PushOn: 4700,
  PushOff: 4701,
  TestSent: 4702,
  PushUnavailable: 4703,
  NoDevice: 4704,
  TestThrottled: 4705,
  TestRejected: 4706,
  MarkedRead: 4710,
  MarkedUnread: 4711,
  AllRead: 4712,
  Deleted: 4713,
  Restored: 4714,
  /** 410: the sync token is older than 30 days; reload with the list. */
  Stale: 4715,
} as const;

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  organization: { id: number; name: string } | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedQuery {
  limit?: number;
  cursor?: string | null;
  unread?: boolean;
  kind?: NotificationKind | null;
  /** Cross-tenant users only; the server ignores it for partners. */
  organization?: number | null;
}

/** `GET /notifications/`. `counts`, `by_kind` and `sync_token` come with the first page only. */
export interface FeedPageDto {
  results: NotificationDto[];
  next_cursor: string | null;
  count: number;
  counts?: { all: number; unread: number };
  by_kind?: Partial<Record<NotificationKind, number>>;
  sync_token?: string;
}

export interface FeedPage {
  results: AppNotification[];
  nextCursor: string | null;
  count: number;
  counts: { all: number; unread: number } | null;
  byKind: Partial<Record<NotificationKind, number>> | null;
  syncToken: string | null;
}

export interface SyncDto {
  changed: NotificationDto[];
  deleted_ids: number[];
  unread: number;
  sync_token: string;
  has_more: boolean;
}

export interface SyncPage {
  changed: AppNotification[];
  deletedIds: number[];
  unread: number;
  syncToken: string;
  hasMore: boolean;
}

export interface PushConfig {
  enabled: boolean;
  vapid_key: string | null;
  web_config: {
    api_key: string | null;
    auth_domain: string | null;
    project_id: string | null;
    storage_bucket: string | null;
    messaging_sender_id: string | null;
    app_id: string | null;
  } | null;
}

export type PushPlatform = 'web' | 'ios' | 'android';

export interface PushTokenBody {
  token: string;
  platform: PushPlatform;
  app_id?: string;
  app_version?: string;
  locale?: string;
  label?: string;
}

/** The token itself is never returned. */
export interface PushTokenDto {
  id: number;
  platform: PushPlatform;
  app_id: string;
  app_version: string;
  locale: string;
  label: string;
  created_at: string;
  last_seen_at: string;
}

/** A success the screen tells the user about in the server's own words. */
export interface Said<T> {
  data: T;
  message: string;
}

export function toNotification(d: NotificationDto): AppNotification {
  return {
    id: d.id,
    orgId: d.organization?.id ?? null,
    orgName: d.organization?.name ?? null,
    at: d.created_at,
    kind: d.kind,
    title: d.title,
    body: d.body,
    link: d.link ? routeOf(d.link) : '',
    read: d.read,
  };
}

export function toFeedPage(d: FeedPageDto): FeedPage {
  return {
    results: d.results.map(toNotification),
    nextCursor: d.next_cursor ?? null,
    count: d.count,
    counts: d.counts ?? null,
    byKind: d.by_kind ?? null,
    syncToken: d.sync_token ?? null,
  };
}

/** True when a sync token can't be used any more (410 `4715`, or a 400 for a bad token): reload the list. */
export function isStaleSync(err: unknown): boolean {
  const e = toApiError(err);
  return e.httpStatus === 410 || e.code === NotificationCode.Stale || e.httpStatus === 400;
}

@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly http = inject(HttpClient);

  // ── Feed (4.1) ──
  async list(q: FeedQuery = {}): Promise<FeedPage> {
    const params = query({
      limit: q.limit,
      cursor: q.cursor,
      unread: q.unread ? 'true' : null,
      kind: q.kind,
      organization: q.organization,
    });
    return toFeedPage(await unwrap(this.http.get<ApiEnvelope<FeedPageDto>>(apiUrl('/notifications/'), { params })));
  }

  async sync(since: string, limit?: number): Promise<SyncPage> {
    const d = await unwrap(
      this.http.get<ApiEnvelope<SyncDto>>(apiUrl('/notifications/sync/'), { params: query({ since, limit }) }),
    );
    return {
      changed: d.changed.map(toNotification),
      deletedIds: d.deleted_ids,
      unread: d.unread,
      syncToken: d.sync_token,
      hasMore: d.has_more,
    };
  }

  async unreadCount(): Promise<number> {
    return (await unwrap(this.http.get<ApiEnvelope<{ unread: number }>>(apiUrl('/notifications/unread-count/')))).unread;
  }

  async setRead(id: number, read: boolean): Promise<AppNotification> {
    return toNotification(
      await unwrap(this.http.patch<ApiEnvelope<NotificationDto>>(apiUrl(`/notifications/${id}/`), { read })),
    );
  }

  /** Other users' ids and no-ops are skipped by the server. */
  setReadMany(ids: number[], read: boolean): Promise<{ updated: number; unread: number }> {
    return unwrap(this.http.post<ApiEnvelope<{ updated: number; unread: number }>>(apiUrl('/notifications/read/'), { ids, read }));
  }

  /** `ids` lets Undo call `setReadMany(ids, false)`. */
  readAll(kind?: NotificationKind | null): Promise<{ updated: number; ids: number[]; unread: number }> {
    return unwrap(
      this.http.post<ApiEnvelope<{ updated: number; ids: number[]; unread: number }>>(
        apiUrl('/notifications/read-all/'),
        kind ? { kind } : {},
      ),
    );
  }

  /** Soft delete; `restore` undoes it within 30 days. */
  remove(ids: number[]): Promise<{ deleted: number; unread: number }> {
    return unwrap(this.http.post<ApiEnvelope<{ deleted: number; unread: number }>>(apiUrl('/notifications/delete/'), { ids }));
  }

  restore(ids: number[]): Promise<{ restored: number; unread: number }> {
    return unwrap(this.http.post<ApiEnvelope<{ restored: number; unread: number }>>(apiUrl('/notifications/restore/'), { ids }));
  }

  // ── Push devices (4.2) ──
  pushConfig(): Promise<PushConfig> {
    return unwrap(this.http.get<ApiEnvelope<PushConfig>>(apiUrl('/notifications/push/config/')));
  }

  registerToken(body: PushTokenBody): Promise<Said<PushTokenDto>> {
    return said(this.http.post<ApiEnvelope<PushTokenDto>>(apiUrl('/notifications/push/tokens/'), body));
  }

  /** Always 200 `4701`; it never reveals whether the token existed. */
  async unregisterToken(token: string): Promise<string> {
    return (await said(this.http.post<ApiEnvelope<unknown>>(apiUrl('/notifications/push/tokens/unregister/'), { token }))).message;
  }

  testPush(platform?: PushPlatform): Promise<Said<{ sent: number; failed: number }>> {
    return said(
      this.http.post<ApiEnvelope<{ sent: number; failed: number }>>(apiUrl('/notifications/push/test/'), platform ? { platform } : {}),
    );
  }
}

/** Like `unwrap`, but keeps the envelope's message for the toast. */
async function said<T>(req: Observable<ApiEnvelope<T>>): Promise<Said<T>> {
  try {
    const env = await firstValueFrom(req);
    return { data: env.data, message: env.message };
  } catch (err) {
    throw toApiError(err);
  }
}
