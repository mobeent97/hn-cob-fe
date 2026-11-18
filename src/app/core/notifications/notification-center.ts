import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Store } from '../data/store';
import { AuthService } from '../auth/auth.service';
import { NotificationsApi } from '../api/notifications.api';
import { errorText } from '../api/api-client';
import { AppNotification, NotificationKind } from '../data/models';

/** The bell shows this many. */
export const BELL_SIZE = 6;
/** The unread count is polled this often while the tab is visible. */
const POLL_MS = 60_000;
/** A focus within this long of the last refresh doesn't refresh again. */
const FOCUS_MIN_MS = 5_000;

/**
 * The signed-in user's notifications for the whole app (PUSH_NOTIFICATIONS.md 6.1): fills the bell
 * (`Store.notifications`, `Store.unread`) on sign-in, on window focus, every 60 s while visible (unread
 * count only) and at once on a foreground push. `changes` ticks on focus and push, so an open
 * Notifications page syncs its own list. Every write goes to the API; the `unread` in each answer
 * updates the badge. No WebSocket or SSE.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private readonly store = inject(Store);
  private readonly api = inject(NotificationsApi);
  private readonly auth = inject(AuthService);

  /** The bell's first load (skeleton) and its failure (Retry in the panel). */
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Ticks when the feed may have changed elsewhere: window focus or a foreground push. */
  readonly changes = signal(0);

  private seq = 0;
  private lastRefresh = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const signedIn = this.auth.isAuthenticated();
      untracked(() => (signedIn ? this.start() : this.stop()));
    });
    const onFocus = () => {
      if (!this.auth.isAuthenticated() || Date.now() - this.lastRefresh < FOCUS_MIN_MS) return;
      void this.refresh();
      this.changes.update((n) => n + 1);
    };
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('focus', onFocus);
      this.stop();
    });
  }

  private start() {
    this.loading.set(true);
    void this.refresh();
    this.timer ??= setInterval(() => {
      if (document.visibilityState === 'visible' && this.auth.isAuthenticated()) void this.pollUnread();
    }, POLL_MS);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seq++;
    this.loading.set(false);
    this.error.set(null);
  }

  /** The bell's rows and the unread total, in one call (`counts.unread` of the first page). */
  async refresh(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    const mine = ++this.seq;
    this.lastRefresh = Date.now();
    this.error.set(null);
    try {
      const page = await this.api.list({ limit: BELL_SIZE });
      if (mine !== this.seq) return;
      this.store.notifications.set(page.results);
      this.store.unread.set(page.counts?.unread ?? (await this.api.unreadCount()));
    } catch (err) {
      if (mine === this.seq) this.error.set(errorText(err));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  /** The 60 s poll: only the count, and the rows too when it changed. */
  async pollUnread(): Promise<void> {
    try {
      const n = await this.api.unreadCount();
      if (n !== this.store.unread()) await this.refresh();
    } catch {
      /* the next poll or focus tries again */
    }
  }

  /** A foreground push arrived: refresh the bell now and let an open page sync. */
  pushed() {
    void this.refresh();
    this.changes.update((n) => n + 1);
  }

  // ── Writes ──
  async setRead(ids: number[], read: boolean): Promise<void> {
    if (!ids.length) return;
    const res = await this.api.setReadMany(ids, read);
    this.patchBell(ids, read);
    this.store.unread.set(res.unread);
  }

  /** Opened from a system notification or a link carrying `n`: PATCH that row read. */
  async markOpened(id: number): Promise<void> {
    try {
      await this.api.setRead(id, true);
      this.patchBell([id], true);
      await this.refresh();
    } catch {
      /* best effort: the row stays unread */
    }
  }

  /** Returns the ids it marked, for Undo. */
  async readAll(kind?: NotificationKind | null): Promise<number[]> {
    const res = await this.api.readAll(kind);
    this.patchBell(res.ids, true);
    this.store.unread.set(res.unread);
    return res.ids;
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const res = await this.api.remove(ids);
    this.store.unread.set(res.unread);
    const gone = new Set(ids);
    if (this.store.notifications().some((n) => gone.has(n.id))) void this.refresh();
  }

  async restore(ids: number[]): Promise<void> {
    const res = await this.api.restore(ids);
    this.store.unread.set(res.unread);
    void this.refresh();
  }

  private patchBell(ids: number[], read: boolean) {
    const set = new Set(ids);
    this.store.notifications.update((xs) => xs.map((n): AppNotification => (set.has(n.id) ? { ...n, read } : n)));
  }
}
