import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { DateTimePipe, RelativePipe } from '../../core/data/format';
import { AppNotification, NotificationKind } from '../../core/data/models';
import { KIND_META } from '../../core/notifications/notification-feed';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { Access } from '../../core/access/access';
import { groupByDay, plural } from './notification-groups';
import { Select, SelectOption } from '../../shared/ui/select';

type View = 'all' | 'unread';
type KindFilter = NotificationKind | 'all';

const STEP = 20;
/** Matches the row collapse in notifications.scss. */
const COLLAPSE_MS = 200;
const KINDS = Object.keys(KIND_META) as NotificationKind[];

/**
 * Notifications — "What happened that I need to act on?"
 * Day-grouped list, newest first. Unread rows carry weight and a blue dot; a row opens what it is
 * about and marks itself read. Motion is feedback only: read state cross-fades, a deleted row
 * collapses, and nothing enters on load.
 */
@Component({
  selector: 'app-notifications',
  imports: [Select, SelectOption, RouterLink, Icon, Tabs, RelativePipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications.html',
  styleUrl: './notifications.css',
})
export class Notifications {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  private readonly access = inject(Access);

  /** A notification's link is only a link when the user may open that screen. */
  protected canOpen(link: string | readonly (string | number)[] | null | undefined) {
    if (!link || !link.length) return false;
    const f = this.access.featureForUrl(typeof link === 'string' ? link : link.join('/'));
    return !f || this.access.can(f);
  }
  protected readonly loading = simulateLoad('notifications');
  protected readonly meta = KIND_META;
  protected readonly kinds = KINDS;

  protected readonly view = signal<View>('all');
  protected readonly kind = signal<KindFilter>('all');
  protected readonly limit = signal(STEP);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  /** Rows mid-collapse, before they leave the store. */
  protected readonly removing = signal<ReadonlySet<number>>(new Set());
  /** Read while the Unread tab is open: they stay put until the view changes, so rows don't jump. */
  private readonly sticky = signal<ReadonlySet<number>>(new Set());

  constructor() {
    effect(() => {
      this.view();
      this.kind();
      untracked(() => {
        this.limit.set(STEP);
        this.selected.set(new Set());
        this.sticky.set(new Set());
      });
    });
  }

  private readonly inView = (n: AppNotification, v: View) => v === 'all' || !n.read || this.sticky().has(n.id);

  /** The finding for the subline: what is unread, and the one thing that blocks someone. */
  protected readonly finding = computed(() => {
    const all = this.store.notifications();
    const unread = all.filter((n) => !n.read);
    if (!all.length) return 'Nothing yet';
    if (!unread.length) return `All caught up · ${plural(all.length, 'notification')}`;
    const parts = [`${unread.length} unread`];
    const del = unread.filter((n) => n.kind === 'deletion').length;
    const orders = unread.filter((n) => n.kind === 'order').length;
    if (del) parts.push(`${plural(del, 'deletion request')} waiting for approval`);
    if (orders) parts.push(`${plural(orders, 'new hardware order')} to ship`);
    return parts.join(' · ');
  });

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const k = this.kind();
    const rows = this.store.notifications().filter((n) => k === 'all' || n.kind === k);
    return [
      { id: 'all', label: 'All', count: rows.length },
      { id: 'unread', label: 'Unread', count: rows.filter((n) => !n.read).length },
    ];
  });

  /** Per-kind counts within the current tab. */
  protected readonly kindCounts = computed(() => {
    const rows = this.store.notifications().filter((n) => this.inView(n, this.view()));
    const out = { all: rows.length } as Record<KindFilter, number>;
    for (const k of KINDS) out[k] = rows.filter((n) => n.kind === k).length;
    return out;
  });

  protected readonly kindLabel = computed(() => {
    const k = this.kind();
    return k === 'all' ? 'All kinds' : KIND_META[k].label;
  });

  protected readonly rows = computed(() => {
    const v = this.view();
    const k = this.kind();
    return this.store.notifications().filter((n) => this.inView(n, v) && (k === 'all' || n.kind === k));
  });
  protected readonly shown = computed(() => this.rows().slice(0, this.limit()));
  protected readonly groups = computed(() => groupByDay(this.shown()));
  protected readonly more = computed(() => Math.max(0, this.rows().length - this.limit()));

  // ── Selection ──
  protected readonly selectedRows = computed(() => this.store.notifications().filter((n) => this.selected().has(n.id)));
  protected readonly selCounts = computed(() => {
    const rows = this.selectedRows();
    const unread = rows.filter((n) => !n.read).length;
    return { unread, read: rows.length - unread };
  });
  protected readonly allShownSelected = computed(() => this.shown().length > 0 && this.shown().every((n) => this.selected().has(n.id)));
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
    this.selected.set(on ? new Set(this.shown().map((n) => n.id)) : new Set());
  }
  protected clearSelection() {
    this.selected.set(new Set());
  }

  // ── Actions ──
  protected open(n: AppNotification) {
    if (!n.read) this.store.markRead([n.id]);
  }

  protected setRead(ids: number[], read: boolean) {
    if (read && this.view() === 'unread') this.sticky.update((s) => new Set([...s, ...ids]));
    this.store.markRead(ids, read);
  }

  protected bulkRead(read: boolean) {
    const ids = this.selectedRows().filter((n) => n.read !== read).map((n) => n.id);
    this.setRead(ids, read);
    this.toast.show(`${plural(ids.length, 'notification')} marked ${read ? 'read' : 'unread'}`);
    this.clearSelection();
  }

  protected markAllRead() {
    const ids = this.store.notifications().filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    this.setRead(ids, true);
    this.toast.show(`${plural(ids.length, 'notification')} marked read`, {
      action: { label: 'Undo', run: () => this.store.markRead(ids, false) },
    });
  }

  protected remove(ids: number[]) {
    if (!ids.length) return;
    const gone = this.store.notifications().filter((n) => ids.includes(n.id));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.removing.update((s) => new Set([...s, ...ids]));
    this.selected.update((s) => new Set([...s].filter((id) => !ids.includes(id))));
    setTimeout(() => {
      this.store.removeNotifications(ids);
      this.removing.update((s) => new Set([...s].filter((id) => !ids.includes(id))));
    }, reduced ? 0 : COLLAPSE_MS);
    this.toast.show(ids.length === 1 ? 'Notification deleted' : `${ids.length} notifications deleted`, {
      action: {
        label: 'Undo',
        run: () =>
          this.store.notifications.update((xs) =>
            [...xs, ...gone.filter((g) => !xs.some((x) => x.id === g.id))].sort((a, b) => b.at.localeCompare(a.at)),
          ),
      },
    });
  }

  protected bulkDelete() {
    this.remove([...this.selected()]);
  }

  protected showAll() {
    this.view.set('all');
    this.kind.set('all');
  }
}
