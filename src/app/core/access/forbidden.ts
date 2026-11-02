import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Access } from './access';
import { FEATURES } from './features';
import { Icon } from '../../shared/ui/icon';

/** Shown in the sheet when a URL points at a feature the user can't open. */
@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <section class="card denied">
        <app-icon name="lock" [size]="20" class="ic" />
        <div>
          <h1>You don't have access to {{ label() }}</h1>
          <p class="muted">{{ reason() }}</p>
          <div class="actions">
            <a class="btn primary" routerLink="/dashboard">Go to Overview</a>
            <a class="btn" routerLink="/help">Ask for access</a>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    .denied { display: flex; gap: 16px; padding: 28px; max-width: 640px; }
    .ic { color: var(--muted); margin-top: 4px; }
    p { margin: 8px 0 20px; line-height: 22px; }
    .actions { display: flex; gap: 8px; }
  `,
})
export class Forbidden {
  private readonly access = inject(Access);
  readonly feature = input<string>('');
  readonly from = input<string>('');
  protected readonly def = computed(() => FEATURES.find((f) => f.key === this.feature()));
  protected readonly label = computed(() => this.def()?.label ?? 'this screen');
  protected readonly reason = computed(() => {
    const f = this.def();
    const org = this.access.org();
    if (f?.platformOnly && org.kind !== 'Platform') return `${f.label} is managed by HyperNym and isn't available to partner organizations.`;
    if (f && !org.features[f.key]) return `${org.name}'s plan doesn't include ${f.label}. An administrator at HyperNym can enable it.`;
    if (this.access.can(f?.key ?? '', 'R')) return `Your role lets you view ${f?.label} but not change it. Ask an administrator in ${org.name} for write access.`;
    return `None of your roles in ${org.name} include ${f?.label ?? 'it'}. Ask an administrator in ${org.name} to add it to one of your roles.`;
  });
}
