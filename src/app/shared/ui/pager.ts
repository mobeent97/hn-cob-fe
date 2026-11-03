import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/**
 * "Showing 11–20 of 312" with Prev / Next, in the shared data-table pagination style. Pages are 1-based.
 */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="table-pagination" aria-label="Table pages">
      <span class="pagination-range num">
        @if (total() === 0) { No results }
        @else { Showing {{ from() }}–{{ to() }} of {{ total() }} {{ noun() }} }
      </span>
      <div class="pagination-controls">
        <button type="button" class="page-step" aria-label="Previous page" [disabled]="page() <= 1" (click)="page.set(page() - 1)">
          Prev
        </button>
        <span class="page-of num">Page {{ page() }} of {{ pages() }}</span>
        <button type="button" class="page-step" aria-label="Next page" [disabled]="page() >= pages()" (click)="page.set(page() + 1)">
          Next
        </button>
      </div>
    </nav>
  `,
  styleUrl: './pager.css',
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
