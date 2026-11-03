import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../data/store';
import { RelativePipe } from '../data/format';
import { AppNotification } from '../data/models';
import { Icon } from '../../shared/ui/icon';
import { KIND_META, NotificationFeed } from './notification-feed';

/**
 * Top-bar bell. The unread badge slides on and pops when the count rises
 * (transitions.dev notification badge); the panel grows from the bell like a menu.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [Icon, RouterLink, RelativePipe],
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
          <button class="btn ghost sm" [disabled]="!unread()" (click)="store.markAllRead()">
            <app-icon name="check-check" [size]="14" />Mark all read
          </button>
        </header>
        <ul>
          @for (n of latest(); track n.id) {
            <li [class.unread]="!n.read">
              <button class="item" (click)="openItem(n)">
                <span class="ic"><app-icon [name]="meta[n.kind].icon" [size]="15" /></span>
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
        <footer>
          <a routerLink="/notifications" (click)="open.set(false)">View all notifications</a>
          <a routerLink="/settings" [queryParams]="{ section: 'notifications' }" (click)="open.set(false)" class="muted">Preferences</a>
        </footer>
      </section>
    }
  `,
  styleUrl: './notification-bell.css',
})
export class NotificationBell {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef<HTMLElement>);
  protected readonly meta = KIND_META;
  protected readonly open = signal(false);
  protected readonly pop = signal(false);
  protected readonly unread = this.store.unread;
  protected readonly latest = computed(() => this.store.notifications().slice(0, 6));

  constructor() {
    inject(NotificationFeed).start(inject(DestroyRef));
    let last = this.unread();
    effect(() => {
      const n = this.unread();
      if (n > last) {
        this.pop.set(false);
        requestAnimationFrame(() => this.pop.set(true));
      }
      last = n;
    });
  }

  protected openItem(n: AppNotification) {
    this.store.markRead([n.id]);
    this.open.set(false);
    this.router.navigate(n.link);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected close() {
    this.open.set(false);
  }
}
