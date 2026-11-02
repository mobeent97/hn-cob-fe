import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { Icon } from './icon';

/** "Showing 11–20 of 312" with previous / next. Pages are 1-based. */
@Component({
  selector: 'app-pager',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-foot">
      <span class="num">
        @if (total() === 0) { No results }
        @else { Showing {{ from() }}–{{ to() }} of {{ total() }} {{ noun() }} }
      </span>
      <div class="pager">
        <span class="num muted">Page {{ page() }} of {{ pages() }}</span>
        <button class="btn icon sm" aria-label="Previous page" [disabled]="page() <= 1" (click)="page.set(page() - 1)">
          <app-icon name="chevron-left" />
        </button>
        <button class="btn icon sm" aria-label="Next page" [disabled]="page() >= pages()" (click)="page.set(page() + 1)">
          <app-icon name="chevron-right" />
        </button>
      </div>
    </div>
  `,
})
export class Pager {
  readonly total = input.required<number>();
  readonly size = input(10);
  readonly noun = input('');
  readonly page = model(1);
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  protected readonly from = computed(() => (this.page() - 1) * this.size() + 1);
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.size()));
}

/** Slice helper used by every paged list. */
export const pageOf = <T>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size);
