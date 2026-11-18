import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DateTimePipe, RelativePipe } from '../../core/data/format';
import { AppNotification, NotificationKind } from '../../core/data/models';
import { KIND_META, kindMeta } from '../../core/notifications/notification-feed';
import { NotificationCenter } from '../../core/notifications/notification-center';
import { FeedFilters, FeedPager } from '../../core/notifications/feed-pager';
import { NotificationsApi } from '../../core/api/notifications.api';
import { errorText } from '../../core/api/api-client';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Toaster } from '../../shared/ui/toast';
import { LoadError } from '../../shared/ui/load-state';
import { Access } from '../../core/access/access';
import { groupByDay, plural } from './notification-groups';
import { Select, SelectOption } from '../../shared/ui/select';

type View = 'all' | 'unread';
type KindFilter = NotificationKind | 'all';

const STEP = 20;
/** Matches the row collapse in notifications.css. */
const COLLAPSE_MS = 200;
const KINDS = Object.keys(KIND_META) as NotificationKind[];

/**
 * Notifications — "What happened that I need to act on?"
 * The persisted feed (GET /notifications/, keyset pages of 20), day-grouped, newest first. Unread rows
 * carry weight and a dot; a row opens what it is about and marks itself read. Focus and foreground pushes
 * sync the loaded rows in place. Motion is feedback only: read state cross-fades, a deleted row collapses,
 * and nothing enters on load.
 */
@Component({
  selector: 'app-notifications',
  imports: [Select, SelectOption, RouterLink, Icon, Tabs, RelativePipe, DateTimePipe, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  private readonly access = inject(Access);
  private readonly router = inject(Router);
  private readonly center = inject(NotificationCenter);
  protected readonly feed = new FeedPager(inject(NotificationsApi), STEP);

  protected readonly meta = kindMeta;
  protected readonly kinds = KINDS;
  protected readonly loading = this.feed.loading;

  protected readonly view = signal<View>('all');
  protected readonly kind = signal<KindFilter>('all');
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  /** Rows mid-collapse, before they leave the list. */
  protected readonly removing = signal<ReadonlySet<number>>(new Set());
  protected readonly marking = signal(false);

  /** The Organization label: only for cross-tenant users looking at every organization. */
  protected readonly showOrg = computed(() => this.store.crossTenant() && this.store.scopeOrgId() == null);

  /** The server filters; the global scope maps to `?organization=` for platform users only. */
  private readonly filters = computed<FeedFilters>(() => {
    const k = this.kind();
    return {
      unread: this.view() === 'unread',
      kind: k === 'all' ? null : k,
      organization: this.store.crossTenant() ? this.store.scopeOrgId() : null,
    };
  });

  constructor() {
    effect(() => {
      const f = this.filters();
      untracked(() => {
        this.selected.set(new Set());
        void this.feed.load(f);
      });
    });
    // Window focus and foreground pushes: bring the loaded rows up to date in place.
    let first = true;
    effect(() => {
      this.center.changes();
      if (first) {
        first = false;
        return;
      }
      untracked(() => void this.feed.refresh());
    });
  }

  /** A notification's link is only a link when the user may open that screen. */
  protected canOpen(link: string | null | undefined) {
    if (!link) return false;
    const f = this.access.featureForUrl(link);
    return !f || this.access.can(f);
  }

  /** The finding for the subline: what is unread, and the one thing that blocks someone. */
  protected readonly finding = computed(() => {
    const c = this.feed.counts();
    if (!c.all) return 'Nothing yet';
    if (!c.unread) return `All caught up · ${plural(c.all, 'notification')}`;
    const parts = [`${c.unread} unread`];
    if (this.view() === 'unread' && this.kind() === 'all') {
      // by_kind applies the unread filter here, so these are unread per kind.
      const k = this.feed.byKind();
      if (k.deletion) parts.push(`${plural(k.deletion, 'deletion request')} waiting for approval`);
      if (k.order) parts.push(`${plural(k.order, 'new hardware order')} to ship`);
    }
    return parts.join(' · ');
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const c = this.feed.counts();
    return [
      { id: 'all', label: 'All', count: c.all },
      { id: 'unread', label: 'Unread', count: c.unread },
    ];
  });

  /** Per-kind counts within the current tab (`by_kind`). */
  protected readonly kindCounts = computed(() => {
    const by = this.feed.byKind();
    const out = { all: 0 } as Record<KindFilter, number>;
    for (const k of KINDS) {
      out[k] = by[k] ?? 0;
      out.all += out[k];
    }
    return out;
  });

  protected readonly kindLabel = computed(() => {
    const k = this.kind();
    return k === 'all' ? 'All kinds' : kindMeta(k).label;
  });

  protected readonly rows = this.feed.rows;
  protected readonly groups = computed(() => groupByDay(this.rows()));
  /** How many "Load more" brings (the last page may be shorter). */
  protected readonly more = computed(() => {
    const left = this.feed.count() - this.rows().length;
    return left > 0 ? Math.min(STEP, left) : STEP;
  });

  // ── Selection ──
  protected readonly selectedRows = computed(() => this.rows().filter((n) => this.selected().has(n.id)));
  protected readonly selCounts = computed(() => {
    const rows = this.selectedRows();
    const unread = rows.filter((n) => !n.read).length;
    return { unread, read: rows.length - unread };
  });
  protected readonly allShownSelected = computed(() => this.rows().length > 0 && this.rows().every((n) => this.selected().has(n.id)));
  protected readonly someSelected = computed(() => this.selected().size > 0 && !this.allShownSelected());

  protected toggle(id: number, on: boolean) {
    this.selected.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  protected toggleAll(on: boolean) {
    this.selected.set(on ? new Set(this.rows().map((n) => n.id)) : new Set());
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }

  // ── Actions ──
  /** Routes in place with `navigateByUrl`, so the link's query parameters survive. */
  protected open(e: MouseEvent, n: AppNotification) {
    const link = this.canOpen(n.link) ? n.link : null;
    const newTab = e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
    if (link && !newTab) {
      e.preventDefault();
      void this.router.navigateByUrl(link);
    }
    if (!n.read) void this.setRead([n.id], true, { quiet: true });
  }

  /** Optimistic: the rows change at once and go back if the server refuses. */
  protected async setRead(ids: number[], read: boolean, { quiet = false } = {}): Promise<boolean> {
    const changing = this.rows().filter((n) => ids.includes(n.id) && n.read !== read).map((n) => n.id);
    if (!changing.length) return false;
    this.feed.patch(changing, { read });
    try {
      await this.center.setRead(changing, read);
      void this.feed.refreshCounts();
      return true;
    } catch (err) {
      this.feed.patch(changing, { read: !read });
      if (!quiet) this.toast.error(`Couldn't mark ${changing.length === 1 ? 'it' : 'them'} ${read ? 'read' : 'unread'}`, errorText(err));
      return false;
    }
  }

  protected async bulkRead(read: boolean) {
    const ids = this.selectedRows().filter((n) => n.read !== read).map((n) => n.id);
    this.clearSelection();
    if (await this.setRead(ids, read)) this.toast.show(`${plural(ids.length, 'notification')} marked ${read ? 'read' : 'unread'}`);
  }

  /** Every unread notification (all kinds), with Undo through POST /notifications/read/. */
  protected async markAllRead() {
    if (this.marking()) return;
    this.marking.set(true);
    try {
      const ids = await this.center.readAll();
      this.feed.patch(ids, { read: true });
      void this.feed.refreshCounts();
      if (!ids.length) return;
      this.toast.show(`${plural(ids.length, 'notification')} marked read`, {
        action: {
          label: 'Undo',
          run: () => {
            this.feed.patch(ids, { read: false });
            this.center.setRead(ids, false).then(
              () => void this.feed.refreshCounts(),
              (err) => {
                this.feed.patch(ids, { read: true });
                this.toast.error("Couldn't undo", errorText(err));
              },
            );
          },
        },
      });
    } catch (err) {
      this.toast.error("Couldn't mark notifications read", errorText(err));
    } finally {
      this.marking.set(false);
    }
  }

  /** Server-side soft delete at once; Undo restores it (it survives a reload). */
  protected async remove(ids: number[]) {
    if (!ids.length) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const collapse = new Promise((r) => setTimeout(r, reduced ? 0 : COLLAPSE_MS));
    this.removing.update((s) => new Set([...s, ...ids]));
    this.selected.update((s) => new Set([...s].filter((id) => !ids.includes(id))));
    const unmark = () => this.removing.update((s) => new Set([...s].filter((id) => !ids.includes(id))));
    try {
      await Promise.all([this.center.remove(ids), collapse]);
    } catch (err) {
      unmark();
      this.toast.error(`Couldn't delete ${ids.length === 1 ? 'the notification' : 'the notifications'}`, errorText(err));
      return;
    }
    const gone = this.feed.remove(ids);
    unmark();
    void this.feed.refreshCounts();
    this.toast.show(ids.length === 1 ? 'Notification deleted' : `${ids.length} notifications deleted`, {
      action: {
        label: 'Undo',
        run: () =>
          this.center.restore(ids).then(
            () => {
              this.feed.reinsert(gone);
              void this.feed.refreshCounts();
            },
            (err) => this.toast.error("Couldn't restore", errorText(err)),
          ),
      },
    });
  }

  protected bulkDelete() {
    void this.remove([...this.selected()]);
  }

  protected reload() {
    void this.feed.load(this.filters());
  }

  protected showAll() {
    this.view.set('all');
    this.kind.set('all');
  }
}
