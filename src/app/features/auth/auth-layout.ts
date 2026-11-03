import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BrandMark } from '../../core/layout/brand-mark';

/**
 * The frame every signed-out screen shares, after IoTility's auth layout (projects/iotility/src/app/auth/auth-layout):
 * a black brand panel with soft purple glows on the left (logo, the one supporting visual, a tagline) and the form
 * card on the canvas to the right. Below 1024px the brand panel goes and the form centres on its own.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth-brand-panel" [attr.aria-label]="asideLabel() || null">
      <div class="auth-backdrop" aria-hidden="true"></div>
      <div class="auth-brand-row">
        <img src="assets/hypernym-loader-full.svg" alt="HyperNym" />
        <span aria-hidden="true"></span>
        <strong>Customer onboarding</strong>
      </div>
      <div class="auth-visual">
        <ng-content select="[aside]" />
      </div>
      <div class="auth-tagline">
        <h1>Customers, devices and orders<br /><span>for every HyperNym fleet</span></h1>
        <p>Part of the IoTility platform.</p>
      </div>
    </section>

    <section class="auth-content-panel">
      <div class="auth-content">
        <header class="mobile-brand">
          <app-brand-mark [size]="24" />
          <span>HyperNym</span>
        </header>
        <div class="auth-card">
          <ng-content />
        </div>
        <footer class="foot">{{ foot() }}</footer>
      </div>
    </section>
  `,
  styleUrl: './auth-layout.css',
})
export class AuthLayout {
  readonly foot = input('Need an account? Ask a HyperNym super admin to invite you.');
  readonly asideLabel = input('');
}
