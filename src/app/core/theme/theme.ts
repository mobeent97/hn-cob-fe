import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'hn-theme';

/**
 * Light / dark / follow-the-system theme. index.html applies the saved choice before first
 * paint; this service keeps <html data-theme> in sync afterwards and cross-fades the switch
 * with a View Transition (skipped under reduced motion).
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly media = matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media.matches);
  readonly pref = signal<ThemePref>((localStorage.getItem(KEY) as ThemePref) ?? 'system');
  readonly mode = computed<'light' | 'dark'>(() =>
    this.pref() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.pref() as 'light' | 'dark'),
  );
  /** Bumps after every applied change, so canvas/map code can re-read the CSS tokens. */
  readonly version = signal(0);

  constructor() {
    const onChange = (e: MediaQueryListEvent) => {
      this.systemDark.set(e.matches);
      this.apply(false);
    };
    this.media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', onChange));
    this.apply(false);
  }

  set(pref: ThemePref) {
    this.pref.set(pref);
    localStorage.setItem(KEY, pref);
    this.apply(true);
  }

  toggle() {
    this.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  private apply(animate: boolean) {
    const root = document.documentElement;
    const next = this.mode();
    if (root.getAttribute('data-theme') === next) return;
    const swap = () => {
      root.setAttribute('data-theme', next);
      this.version.update((v) => v + 1);
    };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce && 'startViewTransition' in document) {
      root.classList.add('theme-swap');
      const vt = (document as Document & { startViewTransition(cb: () => void): { finished: Promise<void> } }).startViewTransition(swap);
      vt.finished.finally(() => root.classList.remove('theme-swap'));
    } else {
      swap();
    }
  }
}
