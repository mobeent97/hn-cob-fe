import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Store } from '../data/store';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { BrandMark } from './brand-mark';
import { NAV, NAV_FOOTER, NavItem } from './nav';
import { GlobalSearch } from './global-search';
import { Theme } from '../theme/theme';
import { NotificationBell } from '../notifications/notification-bell';
import { Access } from '../access/access';
import { ScopeSwitcher } from './scope-switcher';
import { PreviewAs } from './preview-as';

/**
 * Framed-sheet shell: the sidebar and top bar share one tinted frame with no rule between them;
 * the page sits on a white sheet inset 8px from the right and bottom, 16px corners, 1px edge, no shadow.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Menu, BrandMark, GlobalSearch, NotificationBell, ScopeSwitcher, PreviewAs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly access = inject(Access);
  /** Only the features this user can open, groups without any are dropped. */
  protected readonly nav = computed(() =>
    NAV.map((g) => ({ ...g, items: g.items.filter((i) => this.allowed(i)) })).filter((g) => g.items.length),
  );
  protected readonly navFooter = computed(() => NAV_FOOTER.filter((i) => this.allowed(i)));
  protected readonly previewOpen = signal(false);
  protected readonly roleLabel = computed(() =>
    this.user().isSuperuser ? 'Superuser' : this.user().groups.join(', ') || 'No role',
  );
  protected readonly user = this.store.currentUser;
  protected readonly navOpen = signal(false);
  protected readonly theme = inject(Theme);

  protected readonly badges = computed(() => ({
    ordersToShip: this.store.orders().filter((o) => o.status === 'Placed' || o.status === 'Packed').length,
  }));

  protected readonly accountMenu = computed<MenuItem[]>(() => {
    const pref = this.theme.pref();
    const mark = (p: string) => (pref === p ? ' ✓' : '');
    return [
      { label: 'My profile', icon: 'circle-user', run: () => this.router.navigate(['/profile']) },
      { label: 'Notifications', icon: 'bell', run: () => this.router.navigate(['/notifications']) },
      { label: 'Settings', icon: 'settings', run: () => this.router.navigate(['/settings']) },
      { label: `Light theme${mark('light')}`, icon: 'sun', run: () => this.theme.set('light') },
      { label: `Dark theme${mark('dark')}`, icon: 'moon', run: () => this.theme.set('dark') },
      { label: `Match system${mark('system')}`, icon: 'panel', run: () => this.theme.set('system') },
      { label: 'Preview as another user…', icon: 'users', run: () => this.previewOpen.set(true) },
      { label: 'Sign out', icon: 'logout', run: () => this.router.navigate(['/login']) },
    ];
  });

  protected readonly initials = computed(() =>
    this.user()
      .name.split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join(''),
  );

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.navOpen.set(false));
  }

  private allowed(item: NavItem) {
    const f = this.access.featureForUrl(item.path);
    return !f || this.access.can(f, 'R');
  }

  protected badgeFor(item: NavItem) {
    return item.badge ? this.badges()[item.badge] : 0;
  }

  @HostListener('document:keydown.escape')
  protected closeNav() {
    this.navOpen.set(false);
  }
}
