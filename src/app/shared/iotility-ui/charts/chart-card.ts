import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Skeleton } from '../skeleton/skeleton';
import { ChartSkeleton, ChartSkeletonType } from './chart-skeleton';
import { ChartLegendItem } from './chart-theme';

/**
 * Card shell for any chart: title, subtitle, badge, header legend and an actions slot
 * (`[chart-actions]`, e.g. a filter), plus loading, empty and error states. The chart
 * itself is projected as the card's body.
 */
@Component({
  selector: 'ui-chart-card',
  imports: [ChartSkeleton, Skeleton],
  templateUrl: './chart-card.html',
  styleUrl: './chart-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The header already shows the title; keep it out of the browser's native tooltip.
  host: { '[attr.title]': 'null' },
})
export class ChartCard {
  readonly title = input('');
  readonly subtitle = input('');
  readonly badge = input('');
  readonly legend = input<ChartLegendItem[]>([]);
  /** Card height in px; the chart fills whatever is left under the header. */
  readonly height = input<number | null>(null);
  readonly loading = input(false);
  /** Which placeholder shape to show while loading. */
  readonly skeleton = input<ChartSkeletonType>('bar');
  readonly empty = input(false);
  readonly emptyMessage = input('No data available');
  readonly error = input('');
}
