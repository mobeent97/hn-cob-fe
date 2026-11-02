import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** HyperNym mark: four rising signal bars, the IoT link it sells. Drawn, not an image. */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-flex' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="13" width="3.6" height="9" rx="1" fill="var(--accent)" opacity=".45" />
      <rect x="7.5" y="9" width="3.6" height="13" rx="1" fill="var(--accent)" opacity=".65" />
      <rect x="13" y="5" width="3.6" height="17" rx="1" fill="var(--accent)" opacity=".85" />
      <rect x="18.4" y="2" width="3.6" height="20" rx="1" fill="var(--accent)" />
    </svg>
  `,
})
export class BrandMark {
  readonly size = input(22);
}
