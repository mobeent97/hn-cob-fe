import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Store } from '../../core/data/store';

/** Right panel of the password-recovery screens: where the user is in the three steps. */
@Component({
  selector: 'app-auth-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <div class="steps-aside">
      <h2>Reset your password in three steps</h2>
      <ol>
        @for (s of steps(); track s.n) {
          <li [class.current]="s.n === current()" [class.done]="s.n < current()" [attr.aria-current]="s.n === current() ? 'step' : null">
            <span class="n num">{{ s.n }}</span>
            <strong>{{ s.title }}</strong>
            <small>{{ s.body }}</small>
          </li>
        }
      </ol>
      <p class="note">After {{ attempts() }} wrong attempts the account locks for {{ lock() }} minutes.</p>
    </div>
  `,
})
export class AuthSteps {
  private readonly store = inject(Store);
  readonly current = input<1 | 2 | 3>(1);
  protected readonly attempts = computed(() => this.store.settings().login.maxAttempts);
  protected readonly lock = computed(() => this.store.settings().login.lockMinutes);
  protected readonly steps = computed(() => {
    const p = this.store.settings().password;
    return [
      { n: 1, title: 'Enter your work email', body: 'We send a 6-digit code to it.' },
      { n: 2, title: 'Enter the code', body: 'It works once and expires after 10 minutes.' },
      { n: 3, title: 'Choose a new password', body: `At least ${p.minLength} characters. It can't match your last ${p.history}.` },
    ];
  });
}
