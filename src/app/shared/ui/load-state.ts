import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { errorText } from '../../core/api/api-client';
import { Icon } from './icon';

/**
 * Loading and error state for one block that reads the API. `run()` drops answers that arrive after a
 * newer request (search as you type), so only the latest result is applied.
 * Replaces the design phase's simulateLoad on connected screens.
 */
export function loadState(initiallyLoading = true) {
  const loading = signal(initiallyLoading);
  const error = signal<string | null>(null);
  let seq = 0;
  return {
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    /** Resolves to the result, or undefined when it failed or a newer request replaced it. */
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      const mine = ++seq;
      loading.set(true);
      error.set(null);
      try {
        const v = await fn();
        return mine === seq ? v : undefined;
      } catch (e) {
        if (mine === seq) error.set(errorText(e));
        return undefined;
      } finally {
        if (mine === seq) loading.set(false);
      }
    },
  };
}
export type LoadState = ReturnType<typeof loadState>;

/** The error inside the block that failed, with Retry. */
@Component({
  selector: 'app-load-error',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'load-error', role: 'alert' },
  template: `
    <span class="msg"><app-icon name="circle-x" [size]="16" /><span>{{ message() }}</span></span>
    <button type="button" class="btn sm" (click)="retry.emit()"><app-icon name="refresh" [size]="14" />Retry</button>
  `,
})
export class LoadError {
  readonly message = input.required<string>();
  readonly retry = output<void>();
}
