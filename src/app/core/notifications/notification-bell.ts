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
      class="btn ghost icon bell"
      [attr.aria-label]="unread() ? unread() + ' unread notifications' : 'Notifications'"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="$event.stopPropagation(); open.set(!open())"
    >
      <app-icon name="bell" [size]="17" />
      @if (unread()) {
        <span class="badge num" [class.pop]="pop()">{{ unread() > 9 ? '9+' : unread() }}</span>
      }
    </button>

    @if (open()) {
      <section class="panel" role="dialog" aria-label="Notifications" (click)="$event.stopPropagation()">
        <header>
          <h2>Notifications</h2>
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
  styles: `
    :host { position: relative; display: inline-flex; }
    .bell { position: relative; color: var(--muted); }
    .badge {
      position: absolute; top: 2px; right: 1px; min-width: 16px; height: 16px; padding: 0 4px;
      border-radius: 8px; background: var(--negative); color: var(--on-accent);
      font-size: 10px; font-weight: 600; line-height: 16px; text-align: center;
      box-shadow: 0 0 0 2px var(--frame);
      transition: transform var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
      @starting-style { transform: translate(-6px, 8px) scale(0.6); opacity: 0; }
    }
    .badge.pop { animation: pop 500ms var(--ease-bounce); }
    @keyframes pop { 30% { transform: scale(1.25); } }

    .panel {
      position: absolute; right: -8px; top: calc(100% + 8px); z-index: 80; width: 380px; max-width: calc(100vw - 24px);
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-float);
      transform-origin: top right;
      transition: opacity var(--duration-quick) var(--ease-out), transform var(--duration-fast) var(--ease-out);
      @starting-style { opacity: 0; transform: scale(var(--scale-menu)) translateY(-4px); }
    }
    header { display: flex; justify-content: space-between; align-items: center; padding: 12px 12px 8px 16px; }
    ul { list-style: none; margin: 0; padding: 0 6px; max-height: 420px; overflow: auto; }
    li + li { border-top: 1px solid var(--rule); }
    .item {
      width: 100%; display: flex; gap: 10px; align-items: flex-start; text-align: left; border: 0; background: none;
      padding: 10px; border-radius: 6px; color: var(--text); transition: background-color var(--duration-quick) ease;
    }
    .item:hover { background: var(--raised); }
    .ic { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--active); color: var(--muted); }
    .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .text strong { font-weight: 500; }
    li:not(.unread) .text strong { font-weight: 400; color: var(--muted); }
    .body { color: var(--muted); font-size: 13px; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .when { color: var(--faint); font-size: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; flex: none; }
    .none { padding: 18px 12px; color: var(--muted); }
    footer { display: flex; justify-content: space-between; padding: 10px 16px; border-top: 1px solid var(--rule); font-weight: 500; }
    footer a:first-child { color: var(--accent); }
    footer a:hover { text-decoration: underline; text-underline-offset: 3px; }
  `,
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
