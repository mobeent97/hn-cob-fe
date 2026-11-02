import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BrandMark } from '../../core/layout/brand-mark';

/**
 * The frame every signed-out screen shares: the form on the white sheet (left) and a
 * --frame tinted panel (right) for the one supporting thing. Below 900px the panel goes
 * and the form centres on its own.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="form-side">
      <header class="brand">
        <app-brand-mark [size]="24" />
        <span class="wordmark">HyperNym</span>
      </header>
      <div class="form-slot">
        <ng-content />
      </div>
      <footer class="foot">{{ foot() }}</footer>
    </section>
    <aside class="aside" [attr.aria-label]="asideLabel()">
      <ng-content select="[aside]" />
    </aside>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: minmax(440px, 5fr) 7fr;
      min-height: 100dvh;
      background: var(--frame);
    }
    .form-side {
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 0 48px;
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 72px;
      flex: none;
    }
    .wordmark {
      font-weight: 600;
      font-size: 16px;
      letter-spacing: -0.01em;
    }
    .form-slot {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      width: 100%;
      max-width: 360px;
      margin: 0 auto;
      padding: 32px 0;
    }
    .foot {
      height: 64px;
      display: flex;
      align-items: center;
      color: var(--muted);
      font-size: var(--fs-small);
      flex: none;
    }
    .aside {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
      min-width: 0;
      position: relative;
    }
    @media (max-width: 899px) {
      :host {
        grid-template-columns: minmax(0, 1fr);
        background: var(--surface);
      }
      .form-side {
        border-right: 0;
        padding: 0 24px;
      }
      .aside {
        display: none;
      }
    }
  `,
})
export class AuthLayout {
  readonly foot = input('Need an account? Ask a HyperNym super admin to invite you.');
  readonly asideLabel = input('');
}
