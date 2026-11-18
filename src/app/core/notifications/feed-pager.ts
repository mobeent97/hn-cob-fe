import { computed, signal } from '@angular/core';
import { AppNotification, NotificationKind } from '../data/models';
import { FeedPage, FeedQuery, SyncPage, isStaleSync } from '../api/notifications.api';
import { errorText, toApiError } from '../api/api-client';

export interface FeedFilters {
  unread: boolean;
  kind: NotificationKind | null;
  /** `?organization=`, sent only for a cross-tenant user who picked one tenant. */
  organization: number | null;
}

/** What the pager needs from NotificationsApi, so tests can hand it plain functions. */
export interface FeedSource {
  list(q: FeedQuery): Promise<FeedPage>;
  sync(since: string, limit?: number): Promise<SyncPage>;
}

const SYNC_LIMIT = 500;
/** At most this many sync calls per refresh (500 rows per user, so 2 is already everything). */
const SYNC_ROUNDS = 4;

/** Feed order: `created_at DESC, id DESC`. Negative when `a` comes first. */
export function feedOrder(a: AppNotification, b: AppNotification): number {
  const t = Date.parse(b.at) - Date.parse(a.at);
  return t || b.id - a.id;
}

export function matchesFilters(n: AppNotification, f: FeedFilters): boolean {
  return (!f.kind || n.kind === f.kind) && (f.organization == null || n.orgId === f.organization) && (!f.unread || !n.read);
}

/**
 * The Notifications page's list (PUSH_NOTIFICATIONS.md 4.1 and 6.1): keyset pages of `pageSize`
 * ("Load 20 more" passes `next_cursor`), the first page's `counts` / `by_kind`, and in-place sync.
 *
 * Rows already shown are never dropped by a refresh: a row read while the Unread tab is open stays until
 * the filters change, so rows don't jump. A sync inserts a new row only when it falls inside the loaded
 * window (newer than the last loaded row, or everything is loaded); older ones arrive with "Load more".
 */
export class FeedPager {
  readonly rows = signal<AppNotification[]>([]);
  /** Total rows matching the filters. */
  readonly count = signal(0);
  /** The All / Unread tab counts (apply `kind` and `organization`, not `unread`). */
  readonly counts = signal({ all: 0, unread: 0 });
  /** Per kind (applies `unread` and `organization`, not `kind`). */
  readonly byKind = signal<Partial<Record<NotificationKind, number>>>({});
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly loadingMore = signal(false);
  readonly moreError = signal<string | null>(null);
  readonly hasMore = computed(() => !!this.nextCursor());

  private filters: FeedFilters = { unread: false, kind: null, organization: null };
  private syncToken: string | null = null;
  /** Bumped by every first-page load, so answers for older filters are dropped. */
  private seq = 0;
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly source: FeedSource,
    readonly pageSize = 20,
  ) {}

  get current(): FeedFilters {
    return this.filters;
  }

  private query(extra: Partial<FeedQuery> = {}): FeedQuery {
    const f = this.filters;
    return { limit: this.pageSize, unread: f.unread, kind: f.kind, organization: f.organization, ...extra };
  }

  /** First page for these filters. `silent` keeps the current rows on screen (no skeleton). */
  async load(filters: FeedFilters = this.filters, { silent = false } = {}): Promise<void> {
    this.filters = { ...filters };
    const mine = ++this.seq;
    if (!silent) this.loading.set(true);
    this.error.set(null);
    this.moreError.set(null);
    try {
      const page = await this.source.list(this.query());
      if (mine !== this.seq) return;
      this.rows.set(page.results);
      this.applyCounts(page);
      this.nextCursor.set(page.nextCursor);
      this.syncToken = page.syncToken;
    } catch (err) {
      if (mine === this.seq && !silent) this.error.set(errorText(toApiError(err)));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  /** The next keyset page, appended (rows already shown are skipped). */
  async more(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const mine = this.seq;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.source.list(this.query({ cursor }));
      if (mine !== this.seq) return;
      const have = new Set(this.rows().map((n) => n.id));
      this.rows.update((xs) => [...xs, ...page.results.filter((n) => !have.has(n.id))]);
      this.nextCursor.set(page.nextCursor);
      this.count.set(page.count);
    } catch (err) {
      if (mine === this.seq) this.moreError.set(errorText(toApiError(err)));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /**
   * Brings the loaded rows up to date (focus, a foreground push): sync from the first page's token, then
   * refresh the counts. Without a token, or when the server says it is stale, reloads the first page quietly.
   */
  refresh(): Promise<void> {
    this.syncing ??= this.doRefresh().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async doRefresh(): Promise<void> {
    if (this.loading()) return;
    if (!this.syncToken) return this.load(this.filters, { silent: true });
    const mine = this.seq;
    let changed = false;
    try {
      for (let round = 0; round < SYNC_ROUNDS && this.syncToken; round++) {
        const s = await this.source.sync(this.syncToken, SYNC_LIMIT);
        if (mine !== this.seq) return;
        changed = this.apply(s) || changed;
        this.syncToken = s.syncToken;
        if (!s.hasMore) break;
      }
    } catch (err) {
      if (mine === this.seq && isStaleSync(err)) return this.load(this.filters, { silent: true });
      return; // a failed background refresh keeps what is on screen
    }
    if (changed) await this.refreshCounts();
  }

  /** Applies one sync answer to the loaded rows. True when anything visible changed. */
  apply(s: Pick<SyncPage, 'changed' | 'deletedIds'>): boolean {
    let changed = false;
    let rows = this.rows();
    if (s.deletedIds.length) {
      const gone = new Set(s.deletedIds);
      const next = rows.filter((n) => !gone.has(n.id));
      changed ||= next.length !== rows.length;
      rows = next;
    }
    const byId = new Map(rows.map((n, i) => [n.id, i]));
    const last = rows[rows.length - 1];
    const inserted: AppNotification[] = [];
    rows = [...rows];
    for (const n of s.changed) {
      const at = byId.get(n.id);
      if (at !== undefined) {
        if (rows[at].read !== n.read || rows[at].title !== n.title || rows[at].body !== n.body) changed = true;
        rows[at] = n;
      } else if (matchesFilters(n, this.filters) && (!this.hasMore() || !last || feedOrder(n, last) < 0)) {
        inserted.push(n);
      }
    }
    if (inserted.length) {
      rows = [...rows, ...inserted].sort(feedOrder);
      changed = true;
    }
    this.rows.set(rows);
    return changed;
  }

  /** The first page's counts for the current filters, without touching the rows. */
  async refreshCounts(): Promise<void> {
    const mine = this.seq;
    try {
      const page = await this.source.list(this.query({ limit: 1 }));
      if (mine === this.seq) this.applyCounts(page);
    } catch {
      /* counts stay as they were */
    }
  }

  // ── Local changes after the user's own actions (the server already agreed) ──
  patch(ids: number[], change: Partial<Pick<AppNotification, 'read'>>) {
    const set = new Set(ids);
    this.rows.update((xs) => xs.map((n) => (set.has(n.id) ? { ...n, ...change } : n)));
  }

  /** Removes rows and returns them, so Undo can put them back. */
  remove(ids: number[]): AppNotification[] {
    const set = new Set(ids);
    const gone = this.rows().filter((n) => set.has(n.id));
    this.rows.update((xs) => xs.filter((n) => !set.has(n.id)));
    return gone;
  }

  /** Puts restored rows back in feed order (only those that still match the filters). */
  reinsert(rows: AppNotification[]) {
    const have = new Set(this.rows().map((n) => n.id));
    const back = rows.filter((n) => !have.has(n.id) && matchesFilters(n, this.filters));
    if (back.length) this.rows.update((xs) => [...xs, ...back].sort(feedOrder));
  }

  private applyCounts(page: FeedPage) {
    this.count.set(page.count);
    if (page.counts) this.counts.set(page.counts);
    if (page.byKind) this.byKind.set(page.byKind);
  }
}
