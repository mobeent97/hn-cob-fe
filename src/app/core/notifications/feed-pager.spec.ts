import { HttpErrorResponse } from '@angular/common/http';
import { AppNotification } from '../data/models';
import { FeedPage, FeedQuery, SyncPage } from '../api/notifications.api';
import { FeedFilters, FeedPager, FeedSource, feedOrder, matchesFilters } from './feed-pager';

/** Row `id` was created `id` minutes after midnight, so a higher id is newer. */
const row = (id: number, over: Partial<AppNotification> = {}): AppNotification => ({
  id,
  orgId: 3,
  orgName: 'Vodafone Qatar',
  at: new Date(Date.UTC(2026, 10, 18, 0, id)).toISOString(),
  kind: 'deletion',
  title: `N${id}`,
  body: '',
  link: '/audit',
  read: false,
  ...over,
});

const ALL: FeedFilters = { unread: false, kind: null, organization: null };

/** A server in memory: keyset pages over `rows` (newest first), counts on the first page only. */
function fakeSource(rows: AppNotification[]) {
  const calls: FeedQuery[] = [];
  const syncs: SyncPage[] = [];
  const source: FeedSource & { calls: FeedQuery[]; syncs: SyncPage[]; rows: AppNotification[]; syncError?: unknown } = {
    calls,
    syncs,
    rows,
    async list(q: FeedQuery): Promise<FeedPage> {
      calls.push(q);
      const f: FeedFilters = { unread: !!q.unread, kind: q.kind ?? null, organization: q.organization ?? null };
      const match = [...source.rows].sort(feedOrder).filter((n) => matchesFilters(n, f));
      const start = q.cursor ? Number(q.cursor) : 0;
      const limit = q.limit ?? 20;
      const page = match.slice(start, start + limit);
      const next = start + limit < match.length ? String(start + limit) : null;
      const first = !q.cursor;
      const tab = source.rows.filter((n) => matchesFilters(n, { ...f, unread: false }));
      return {
        results: page,
        nextCursor: next,
        count: match.length,
        counts: first ? { all: tab.length, unread: tab.filter((n) => !n.read).length } : null,
        byKind: first ? { deletion: match.filter((n) => n.kind === 'deletion').length } : null,
        syncToken: first ? 'sync-0' : null,
      };
    },
    async sync(): Promise<SyncPage> {
      if (source.syncError) throw source.syncError;
      return syncs.shift() ?? { changed: [], deletedIds: [], unread: 0, syncToken: 'sync-x', hasMore: false };
    },
  };
  return source;
}

describe('FeedPager (cursor paging, PUSH_NOTIFICATIONS.md 4.1)', () => {
  const fifty = () => Array.from({ length: 50 }, (_, i) => row(i + 1, { read: i % 2 === 0 }));

  it('loads the first page with its counts, then appends keyset pages until next_cursor is null', async () => {
    const src = fakeSource(fifty());
    const pager = new FeedPager(src, 20);
    await pager.load(ALL);
    expect(pager.rows().map((n) => n.id).slice(0, 3)).toEqual([50, 49, 48]);
    expect(pager.rows()).toHaveLength(20);
    expect(pager.count()).toBe(50);
    expect(pager.counts()).toEqual({ all: 50, unread: 25 });
    expect(pager.hasMore()).toBe(true);
    expect(src.calls[0]).toEqual({ limit: 20, unread: false, kind: null, organization: null });

    await pager.more();
    expect(src.calls[1].cursor).toBe('20');
    expect(pager.rows()).toHaveLength(40);
    await pager.more();
    expect(pager.rows()).toHaveLength(50);
    expect(pager.hasMore()).toBe(false);
    // No cursor left: nothing more is requested.
    await pager.more();
    expect(src.calls).toHaveLength(3);
    // Counts stay from the first page (later pages don't carry them).
    expect(pager.counts()).toEqual({ all: 50, unread: 25 });
  });

  it('sends the filters, and a new filter starts from the first page again', async () => {
    const src = fakeSource(fifty());
    const pager = new FeedPager(src, 20);
    await pager.load({ unread: true, kind: 'deletion', organization: 3 });
    expect(src.calls[0]).toEqual({ limit: 20, unread: true, kind: 'deletion', organization: 3 });
    expect(pager.rows().every((n) => !n.read)).toBe(true);
    await pager.more();
    expect(src.calls[1]).toMatchObject({ unread: true, kind: 'deletion', organization: 3, cursor: '20' });
    await pager.load(ALL);
    expect(src.calls[2].cursor).toBeUndefined();
  });

  it('skips rows it already shows when a page overlaps', async () => {
    const src = fakeSource(fifty());
    const pager = new FeedPager(src, 20);
    await pager.load(ALL);
    // A row deleted elsewhere shifts the server's window; keyset cursors don't duplicate, but stay safe.
    src.list = async () => ({ results: [row(31), row(30), row(29)], nextCursor: null, count: 50, counts: null, byKind: null, syncToken: null });
    await pager.more();
    expect(pager.rows().filter((n) => n.id === 31)).toHaveLength(1);
    expect(pager.rows()).toHaveLength(22);
  });

  it('drops an answer for filters that changed meanwhile', async () => {
    const src = fakeSource(fifty());
    const pager = new FeedPager(src, 20);
    const slow = pager.load({ ...ALL, kind: 'order' });
    const fast = pager.load(ALL);
    await Promise.all([slow, fast]);
    expect(pager.rows()).toHaveLength(20);
    expect(pager.current.kind).toBeNull();
  });

  it('shows the error of a failed first page and of a failed "Load more" separately', async () => {
    const src = fakeSource(fifty());
    const pager = new FeedPager(src, 20);
    const list = src.list;
    src.list = async () => {
      throw new HttpErrorResponse({ status: 500, error: { status: 9000, message: 'Server down', data: null } });
    };
    await pager.load(ALL);
    expect(pager.error()).toBe('Server down');
    expect(pager.loading()).toBe(false);
    src.list = list;
    await pager.load(ALL);
    expect(pager.error()).toBeNull();
    src.list = async () => {
      throw new HttpErrorResponse({ status: 500, error: { status: 9000, message: 'Try later', data: null } });
    };
    await pager.more();
    expect(pager.moreError()).toBe('Try later');
    expect(pager.rows()).toHaveLength(20);
  });

  describe('refresh by sync', () => {
    it('updates rows in place, removes deleted ones and inserts new rows inside the loaded window', async () => {
      const src = fakeSource(fifty());
      const pager = new FeedPager(src, 20);
      await pager.load(ALL);
      src.syncs.push({
        changed: [row(50, { read: true }), row(60), row(5)],
        deletedIds: [49],
        unread: 1,
        syncToken: 'sync-1',
        hasMore: false,
      });
      await pager.refresh();
      const ids = pager.rows().map((n) => n.id);
      expect(ids[0]).toBe(60); // new, newer than everything shown
      expect(ids).not.toContain(49); // deleted elsewhere
      expect(ids).not.toContain(5); // older than the loaded window: arrives with "Load more"
      expect(pager.rows().find((n) => n.id === 50)?.read).toBe(true);
      // Something changed, so the counts were refreshed with a one-row first page.
      expect(src.calls.at(-1)).toMatchObject({ limit: 1 });
    });

    it('keeps calling sync while has_more', async () => {
      const src = fakeSource(fifty());
      const pager = new FeedPager(src, 20);
      await pager.load(ALL);
      src.syncs.push(
        { changed: [row(61)], deletedIds: [], unread: 0, syncToken: 'a', hasMore: true },
        { changed: [row(62)], deletedIds: [], unread: 0, syncToken: 'b', hasMore: false },
      );
      await pager.refresh();
      expect(pager.rows().map((n) => n.id).slice(0, 2)).toEqual([62, 61]);
      expect(src.syncs).toHaveLength(0);
    });

    it('does not insert rows that fail the filters, but keeps a row read while the Unread tab is open', async () => {
      const src = fakeSource(fifty());
      const pager = new FeedPager(src, 20);
      await pager.load({ ...ALL, unread: true });
      const first = pager.rows()[0];
      src.syncs.push({
        changed: [{ ...first, read: true }, row(70, { read: true }), row(71, { kind: 'order' })],
        deletedIds: [],
        unread: 0,
        syncToken: 's',
        hasMore: false,
      });
      await pager.load({ ...ALL, unread: true, kind: 'deletion' });
      await pager.refresh();
      expect(pager.rows()[0]).toMatchObject({ id: first.id, read: true });
      expect(pager.rows().map((n) => n.id)).not.toContain(70);
      expect(pager.rows().map((n) => n.id)).not.toContain(71);
    });

    it('reloads the first page quietly when the sync token is stale (410 4715)', async () => {
      const src = fakeSource(fifty());
      const pager = new FeedPager(src, 20);
      await pager.load(ALL);
      await pager.more();
      src.syncError = new HttpErrorResponse({ status: 410, error: { status: 4715, message: 'Out of date', data: null } });
      const before = src.calls.length;
      await pager.refresh();
      expect(src.calls.length).toBe(before + 1);
      expect(src.calls.at(-1)?.cursor).toBeUndefined();
      expect(pager.rows()).toHaveLength(20);
      expect(pager.error()).toBeNull();
    });

    it('keeps what is on screen when a background refresh fails for another reason', async () => {
      const src = fakeSource(fifty());
      const pager = new FeedPager(src, 20);
      await pager.load(ALL);
      src.syncError = new HttpErrorResponse({ status: 0 });
      await pager.refresh();
      expect(pager.rows()).toHaveLength(20);
      expect(pager.error()).toBeNull();
    });
  });

  describe('local changes', () => {
    it('patches, removes and reinserts rows in feed order', async () => {
      const pager = new FeedPager(fakeSource(fifty()), 20);
      await pager.load(ALL);
      pager.patch([50, 48], { read: true });
      expect(pager.rows().filter((n) => n.read && [50, 48].includes(n.id))).toHaveLength(2);
      const gone = pager.remove([49, 47]);
      expect(gone.map((n) => n.id)).toEqual([49, 47]);
      expect(pager.rows().map((n) => n.id).slice(0, 3)).toEqual([50, 48, 46]);
      pager.reinsert(gone);
      expect(pager.rows().map((n) => n.id).slice(0, 4)).toEqual([50, 49, 48, 47]);
      pager.reinsert(gone); // twice is harmless
      expect(pager.rows()).toHaveLength(20);
    });
  });
});
