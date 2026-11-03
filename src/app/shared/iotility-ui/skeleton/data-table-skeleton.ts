import { Component, input } from '@angular/core';
import { Skeleton } from './skeleton';

@Component({
  selector: 'ui-data-table-skeleton',
  imports: [Skeleton],
  templateUrl: './data-table-skeleton.html',
  styleUrl: './data-table-skeleton.css',
  // The card header already renders the title, so keep it out of the browser's native tooltip.
  host: { '[attr.title]': 'null' },
})
export class DataTableSkeleton {
  readonly title = input('Data');
  readonly columns = input(5);
  readonly columnLabels = input<string[]>([]);
  readonly rows = input(10);
  readonly showToolbar = input(true);
  /** Mirrors DataTable.showSearch: hide the toolbar search when a filter bar owns it. */
  readonly showSearch = input(true);
  /** Mirrors DataTable.showExport so the placeholder row matches the real toolbar. */
  readonly showExport = input(false);
  readonly showHeaderFilter = input(false);
  readonly leadingVisual = input(false);
  readonly twoLineFirstColumn = input(false);
  readonly compactRows = input(false);
  readonly rowHeight = input(56);
  readonly minTableWidth = input(760);
  protected columnItems(): undefined[] {
    return Array.from({ length: this.columns() });
  }
  protected rowItems(): undefined[] {
    return Array.from({ length: this.rows() });
  }
  protected columnLabel(index: number): string {
    return this.columnLabels()[index] ?? '';
  }
}
