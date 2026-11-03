import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Skeleton } from '../skeleton/skeleton';
import { Tooltip } from '../tooltip/tooltip';

export type StatusBadgeVariant = 'dot' | 'ping' | 'pill' | 'header' | 'map';

@Component({
  selector: 'shared-status-badge',
  imports: [Skeleton, Tooltip],
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly online = input(false);
  readonly variant = input<StatusBadgeVariant>('pill');
  readonly label = input('');
  readonly onlineLabel = input('Live');
  readonly offlineLabel = input('Offline');
  readonly onlineTitle = input('');
  readonly offlineTitle = input('');
  readonly loading = input(false);

  protected readonly effectiveOnline = computed(() => this.online() && !this.loading());
  protected readonly text = computed(() =>
    this.label() || (this.effectiveOnline() ? this.onlineLabel() : this.offlineLabel()),
  );
  protected readonly title = computed(() =>
    this.effectiveOnline() ? this.onlineTitle() : this.offlineTitle(),
  );
  protected readonly showText = computed(
    () => this.variant() !== 'dot' && this.variant() !== 'ping' && !!this.text(),
  );
}