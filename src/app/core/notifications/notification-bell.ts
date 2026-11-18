import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../data/store';
import { RelativePipe } from '../data/format';
import { AppNotification } from '../data/models';
import { Icon } from '../../shared/ui/icon';
import { LoadError } from '../../shared/ui/load-state';
import { Toaster } from '../../shared/ui/toast';
import { errorText } from '../api/api-client';
import { kindMeta } from './notification-feed';
import { BELL_SIZE, NotificationCenter } from './notification-center';
import { routeOf } from './link';
import { Access } from '../access/access';

/**
 * Top-bar bell. The unread badge slides on and pops when the count rises
 * (transitions.dev notification badge); the panel grows from the bell like a menu.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [Icon, RouterLink, RelativePipe, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="bell"
      [attr.aria-label]="unread() ? unread() + ' unread notifications' : 'Notifications'"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="$event.stopPropagation(); open.set(!open())"
    >
      <app-icon name="bell" [size]="18" [stroke]="1.7" [class.swing]="pop()" />
      @if (unread()) {
        <span class="badge num" [class.pop]="pop()">{{ unread() > 9 ? '9+' : unread() }}</span>
      }
    </button>

    @if (open()) {
      <section class="panel" animate.leave="panel-leave" role="dialog" aria-label="Notifications" (click)="$event.stopPropagation()">
        <header>
          <div><strong>Notifications</strong><small>Orders, deletion requests and device alerts</small></div>
          <button class="btn ghost sm" [disabled]="!unread() || marking()" (click)="markAllRead()">
            <app-icon name="check-check" [size]="14" />Mark all read
          </button>
        </header>
        @if (center.loading() && !latest().length) {
          <ul aria-busy="true">
            @for (i of skeletonRows; track i) {
              <li><div class="item sk">
                <span class="skeleton" style="width:32px;height:32px;border-radius:50%"></span>
                <span class="text">
                  <span class="skeleton" style="width:70%;height:11px"></span>
                  <span class="skeleton" style="width:95%;height:11px"></span>
                  <span class="skeleton" style="width:40px;height:10px"></span>
                </span>
              </div></li>
            }
          </ul>
        } @else if (center.error() && !latest().length) {
          <div class="failed"><app-load-error [message]="center.error()!" (retry)="center.refresh()" /></div>
        } @else {
          <ul>
            @for (n of latest(); track n.id) {
              <li [class.unread]="!n.read">
                <button class="item" (click)="openItem(n)">
                  <span class="ic"><app-icon [name]="meta(n.kind).icon" [size]="15" /></span>
                  <span class="text">
                    <strong>{{ n.title }}</strong>
                    <span class="body">{{ n.body }}</span>
                    <span class="when">{{ n.at | rel }}</span>
                  </span>
                  @if (!n.read) { <span class="dot" aria-label="Unread"></span> }
                </button>
              </li>
            } @empty {
              <li class="none">You're all caught up. New orders, deletion requests and device alerts show up here.</li>
            }
          </ul>
        }
        <footer>
          <a routerLink="/notifications" (click)="open.set(false)">View all notifications</a>
          <a routerLink="/profile" [queryParams]="{ section: 'notifications' }" (click)="open.set(false)" class="muted">Preferences</a>
        </footer>
      </section>
    }
  `,
  styleUrl: './notification-bell.css',
})
export class NotificationBell {
  protected readonly store = inject(Store);
  protected readonly center = inject(NotificationCenter);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  private readonly access = inject(Access);
  protected readonly meta = kindMeta;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly open = signal(false);
  protected readonly pop = signal(false);
  protected readonly marking = signal(false);
  protected readonly unread = this.store.unread;
  protected readonly latest = computed(() => this.store.notifications().slice(0, BELL_SIZE));

  constructor() {
    let last = this.unread();
    effect(() => {
      const n = this.unread();
      if (n > last) {
        this.pop.set(false);
        requestAnimationFrame(() => this.pop.set(true));
      }
      last = n;
    });
    // Opening the panel shows the latest rows, not the ones from the last poll.
    effect(() => {
      if (this.open()) untracked(() => void this.center.refresh());
    });
  }

  protected openItem(n: AppNotification) {
    this.open.set(false);
    if (!n.read) this.center.setRead([n.id], true).catch((err) => this.toast.error("Couldn't mark it read", errorText(err)));
    // Same rule as the Notifications page: a link to a screen the user can't open goes to the feed instead.
    const f = n.link ? this.access.featureForUrl(n.link) : null;
    const link = n.link && (!f || this.access.can(f)) ? n.link : '/notifications';
    void this.router.navigateByUrl(routeOf(link));
  }

  protected async markAllRead() {
    this.marking.set(true);
    try {
      const ids = await this.center.readAll();
      if (ids.length) {
        this.toast.show(ids.length === 1 ? '1 notification marked read' : `${ids.length} notifications marked read`, {
          action: { label: 'Undo', run: () => void this.center.setRead(ids, false).catch((err) => this.toast.error("Couldn't undo", errorText(err))) },
        });
      }
    } catch (err) {
      this.toast.error("Couldn't mark notifications read", errorText(err));
    } finally {
      this.marking.set(false);
    }
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected close() {
    this.open.set(false);
  }
}
