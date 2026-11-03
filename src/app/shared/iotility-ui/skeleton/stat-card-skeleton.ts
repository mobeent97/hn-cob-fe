import { Component, input } from '@angular/core';
import { Skeleton } from './skeleton';

@Component({
  selector: 'ui-stat-card-skeleton',
  imports: [Skeleton],
  templateUrl: './stat-card-skeleton.html',
  styleUrl: './stat-card-skeleton.css',
})
export class StatCardSkeleton {
  readonly compact = input(false);
  readonly showIcon = input(true);
  readonly valueWidth = input('3rem');
  readonly labelWidth = input('4.5rem');
}
