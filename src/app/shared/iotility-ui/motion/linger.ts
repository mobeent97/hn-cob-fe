import { DestroyRef, Signal, effect, inject, signal, untracked } from '@angular/core';

/**
 * Mirrors `source`, but holds on to its last non-null value for `ms` after it turns null.
 * Render a closing drawer/panel from this so its content stays put while the exit animation runs,
 * instead of the box collapsing empty. Call from an injection context (e.g. a field initializer).
 */
export function lingerWhileClosing<T>(source: Signal<T | null>, ms = 280): Signal<T | null> {
  const shown = signal<T | null>(untracked(source));
  let timer: ReturnType<typeof setTimeout> | undefined;

  effect(() => {
    const value = source();
    clearTimeout(timer);
    if (value !== null && value !== undefined) {
      shown.set(value);
    } else {
      timer = setTimeout(() => shown.set(null), ms);
    }
  });
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));

  return shown.asReadonly();
}
