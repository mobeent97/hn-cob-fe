import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ChartSkeletonType = 'line' | 'bar' | 'bar-horizontal' | 'donut';

let nextSkeletonId = 0;

/**
 * Placeholder in each chart type's shape (calm shapes, not fake data), in the same tones
 * and shimmer as ui-skeleton so loading cards read as one family.
 */
@Component({
  selector: 'ui-chart-skeleton',
  templateUrl: './chart-skeleton.html',
  styleUrl: './chart-skeleton.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[class]': "'type-' + type()" },
})
export class ChartSkeleton {
  readonly type = input<ChartSkeletonType>('bar');
  /** Show legend placeholders under the plot. */
  readonly legend = input(false);

  protected readonly gradientId = `chart-skeleton-area-${++nextSkeletonId}`;
  protected readonly yTicks = [70, 100, 85, 60];
  protected readonly xTicks = [1, 2, 3, 4, 5, 6];
  protected readonly bars = [42, 68, 53, 81, 62, 47, 74];
  protected readonly rows = [82, 64, 71, 48, 57, 36];
  protected readonly legendItems = [1, 2, 3];
}
