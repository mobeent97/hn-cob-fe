import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect,
  inject, signal, untracked, viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TabIndicator, Tooltip } from '@iotility/shared-ui';
import { Store } from '../data/store';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { NAV, NAV_FOOTER, NavItem } from './nav';
import { GlobalSearch } from './global-search';
import { Theme } from '../theme/theme';
import { NotificationBell } from '../notifications/notification-bell';
import { Access } from '../access/access';
import { ScopeSwitcher } from './scope-switcher';
import { PreviewAs } from './preview-as';

const COLLAPSED_KEY = 'hn-sidebar-collapsed';
/** Must match the sidebar's own width transition (--sidebar-motion in shell.css). */
const SIDEBAR_MOTION_MS = 260;
const SIDEBAR_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * FleetPoint's layout shell (iotility projects/fleetpoint/src/app/layout): a full-height sidebar on the
 * dark purple gradient that collapses to icons, a white h-16 header, and the page on bg-canvas.
 * Below 768px the sidebar is an off-canvas drawer with a backdrop.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, TabIndicator, Tooltip, Icon, Menu, GlobalSearch, NotificationBell,
    ScopeSwitcher, PreviewAs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly access = inject(Access);
  private readonly injector = inject(Injector);
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
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
  /** Phone drawer. */
  protected readonly navOpen = signal(false);
  /** Desktop icon-only sidebar, remembered between visits. */
  protected readonly collapsed = signal(readCollapsed());
  private readonly phoneQuery = matchMedia('(max-width: 767px)');
  private readonly phone = signal(this.phoneQuery.matches);
  /** The phone drawer always opens full width, whatever the desktop choice is. */
  protected readonly railed = computed(() => this.collapsed() && !this.phone());
  protected readonly theme = inject(Theme);
  private slide?: Animation;

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
      { label: 'Sign out', icon: 'logout', danger: true, run: () => this.router.navigate(['/login']) },
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
    const onPhoneChange = (e: MediaQueryListEvent) => this.phone.set(e.matches);
    this.phoneQuery.addEventListener('change', onPhoneChange);
    inject(DestroyRef).onDestroy(() => this.phoneQuery.removeEventListener('change', onPhoneChange));

    /*
     * Collapse/expand without re-laying out the page every frame (FleetpointLayout): the sidebar slot snaps to
     * its final width once while the sidebar animates its own width over the content, and the content column
     * slides from its old position with a transform on the same timing.
     */
    let first = true;
    effect(() => {
      this.collapsed();
      if (first) {
        first = false;
        return;
      }
      const before = untracked(() => this.content()?.nativeElement.getBoundingClientRect().left);
      untracked(() => afterNextRender(() => this.slideContent(before), { injector: this.injector }));
    });
  }

  private allowed(item: NavItem) {
    const f = this.access.featureForUrl(item.path);
    return !f || this.access.can(f, 'R');
  }

  protected badgeFor(item: NavItem) {
    return item.badge ? this.badges()[item.badge] : 0;
  }

  protected toggleCollapsed() {
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(COLLAPSED_KEY, this.collapsed() ? '1' : '0');
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
  }

  /** Sliding hover highlight: one pill glides to whichever item the pointer is over (FleetpointSidebar). */
  protected highlightNav(event: PointerEvent) {
    const nav = event.currentTarget as HTMLElement;
    const pill = nav.querySelector<HTMLElement>('.nav-hover');
    const item = (event.target as HTMLElement).closest<HTMLElement>('a');
    if (!pill || !item || !nav.contains(item)) return;
    // The active item has its own sliding pill; don't stack a second one on it.
    if (item.classList.contains('active')) {
      pill.style.opacity = '0';
      return;
    }
    const navBox = nav.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    const firstShow = !pill.classList.contains('ready') || pill.style.opacity !== '1';
    if (firstShow) pill.classList.remove('ready'); // appear in place, don't slide in from the last spot
    pill.style.transform = `translate(${box.left - navBox.left + nav.scrollLeft}px, ${box.top - navBox.top + nav.scrollTop}px)`;
    pill.style.width = `${box.width}px`;
    pill.style.height = `${box.height}px`;
    if (firstShow) {
      void pill.offsetWidth;
      pill.classList.add('ready');
    }
    pill.style.opacity = '1';
  }

  protected clearNavHighlight(event: PointerEvent) {
    const pill = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.nav-hover');
    if (pill) pill.style.opacity = '0';
  }

  private slideContent(before: number | undefined) {
    const content = this.content()?.nativeElement;
    if (!content || before === undefined) return;
    this.slide?.cancel();
    const shift = before - content.getBoundingClientRect().left;
    const desktop = !matchMedia('(max-width: 767px)').matches;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!shift || !desktop || reduced) return;
    // Expanding narrows the content; fill the strip it leaves on the right while it slides back.
    content.style.setProperty('--slide-gap', `${Math.max(0, -shift)}px`);
    content.classList.add('sliding');
    this.slide = content.animate([{ transform: `translateX(${shift}px)` }, { transform: 'translateX(0)' }], {
      duration: SIDEBAR_MOTION_MS,
      easing: SIDEBAR_EASING,
    });
    this.slide.finished.catch(() => undefined).finally(() => content.classList.remove('sliding'));
  }

  @HostListener('document:keydown.escape')
  protected closeNav() {
    this.navOpen.set(false);
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
