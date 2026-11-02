import { Signal, WritableSignal, computed } from '@angular/core';

/**
 * A list signal seen through the current tenant scope. Reading returns only rows in scope;
 * `update` and `set` work on the scoped rows and leave everything outside the scope untouched,
 * so every existing screen becomes tenant-aware without changing its code.
 * In the Django API this is the queryset filter on `organization`.
 */
export interface ScopedSignal<T> {
  (): T[];
  update(fn: (rows: T[]) => T[]): void;
  set(rows: T[]): void;
  /** Every row, ignoring the scope. Platform code only (e.g. Organizations counts). */
  readonly all: WritableSignal<T[]>;
}

export function scoped<T>(raw: WritableSignal<T[]>, inScope: Signal<(row: T) => boolean>): ScopedSignal<T> {
  const view = computed(() => {
    const keep = inScope();
    return raw().filter(keep);
  });
  const read = (() => view()) as ScopedSignal<T>;
  read.update = (fn) => {
    const keep = inScope();
    raw.update((rows) => [...fn(rows.filter(keep)), ...rows.filter((r) => !keep(r))]);
  };
  read.set = (rows) => read.update(() => rows);
  Object.defineProperty(read, 'all', { value: raw });
  return read;
}
