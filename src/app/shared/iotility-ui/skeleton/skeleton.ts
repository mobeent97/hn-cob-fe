import { Component, input } from '@angular/core';

export type SkeletonVariant = 'block' | 'text' | 'circle';

@Component({
  selector: 'ui-skeleton',
  template: '<span class="skeleton" [class.skeleton-circle]="variant() === \'circle\'" aria-hidden="true"></span>',
  styleUrl: './skeleton.css',
  host: {
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    '[style.--skeleton-radius]': 'radius()',
  },
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('block');
  readonly width = input('100%');
  readonly height = input('1rem');
  readonly radius = input('0.5rem');
}
