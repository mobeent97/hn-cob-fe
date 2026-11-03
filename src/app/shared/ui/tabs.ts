import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { TabIndicator } from '@iotility/shared-ui';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

/**
 * FleetPoint underline tabs (drivers-page .driver-tabs): muted labels on a hairline, the active one in brand,
 * and IoTility's [sharedTabIndicator] bar sliding between them.
 */
@Component({
  selector: 'app-tabs',
  imports: [TabIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" sharedTabIndicator>
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="t.id === value()"
          [class.active]="t.id === value()"
          (click)="value.set(t.id)"
        >
          {{ t.label }}
          @if (t.count !== undefined) { <span class="count num">{{ t.count }}</span> }
        </button>
      }
    </div>
  `,
  styleUrl: './tabs.css',
})
export class Tabs<T extends string = string> {
  readonly tabs = input.required<TabItem<T>[]>();
  readonly value = model.required<T>();
}
