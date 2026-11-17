import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { AuthService } from '../../core/auth/auth.service';
import { SettingsApi } from '../../core/api/settings.api';
import { AuthCode, AuthError, NETWORK_ERROR_MESSAGE } from '../../core/auth/auth.models';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { AuthSteps } from './auth-steps';
import { replayShake } from './shake';

interface Rule {
  id: string;
  label: string;
  ok: boolean;
}

/**
 * Set a new password — "Does my new password meet the policy?"
 * The checklist is built from Settings → password policy and ticks as each rule passes,
 * so the server check (still required) never surprises anyone. Nothing is stored here.
 * Submits POST /auth/reset-password/ with the reset token /forgot-password left in sessionStorage
 * (resetTokenGuard sends visitors without one back there).
 */
@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, Icon, AuthLayout, AuthSteps],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./auth-form.css', './reset-password.css'],
  template: `
    <app-auth-layout asideLabel="Steps to reset your password">
      @if (!done()) {
        <form class="auth-form t-shake" #form novalidate (submit)="submit($event)">
          <div class="form-head">
            <h1>Set a new password</h1>
            <p>
              @if (email()) { For <strong>{{ email() }}</strong>. }
              You'll sign in with it from now on.
            </p>
          </div>
          @if (expired) {
            <p class="form-note" role="status"><app-icon name="info" /><span>Your password has expired. Choose a new one to continue.</span></p>
          }

          <div class="field">
            <label for="new-pw">New password</label>
            <div class="pw">
              <input id="new-pw" class="ui-control ui-control-lg" [type]="show() ? 'text' : 'password'" autocomplete="new-password"
                     aria-describedby="pw-rules" [value]="pw()" (input)="pw.set($any($event.target).value)" />
              <button type="button" class="reveal" (click)="show.set(!show())"
                      [attr.aria-label]="show() ? 'Hide passwords' : 'Show passwords'" [attr.aria-pressed]="show()">
                <app-icon [name]="show() ? 'eye-off' : 'eye'" />
              </button>
            </div>
          </div>

          <div class="field">
            <label for="confirm-pw">Confirm new password</label>
            <input id="confirm-pw" class="ui-control ui-control-lg" [type]="show() ? 'text' : 'password'" autocomplete="new-password"
                   [class.invalid]="mismatch() || serverMismatch()" [value]="confirm()" (input)="confirm.set($any($event.target).value); serverMismatch.set(false)" />
            @if (mismatch() || serverMismatch()) {
              <span class="error">The two passwords don't match yet.</span>
            }
          </div>

          <ul class="rules" id="pw-rules" aria-label="Password rules">
            @for (r of rules(); track r.id) {
              <li [class.ok]="r.ok">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="7.5" />
                  <path d="M5 8.2 7.1 10.2 11 6" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>{{ r.label }}<span class="sr-only">{{ r.ok ? ', done' : ', not yet' }}</span></span>
              </li>
            }
          </ul>

          <button class="btn primary block" type="submit" [disabled]="busy()" [attr.aria-busy]="busy()">
            <span class="t-text-soft" [class.is-swapping]="busy()">
              <span class="t-text-soft-old" [attr.aria-hidden]="busy()">Save new password</span>
              <span class="t-text-soft-new" [attr.aria-hidden]="!busy()">Saving…</span>
            </span>
          </button>
          <div aria-live="polite">
            @if (error(); as e) {
              <div class="form-error" role="alert">
                <app-icon name="circle-x" />
                <span>
                  {{ e.message }}
                  @if (e.list.length) {
                    <ul>
                      @for (m of e.list; track m) { <li>{{ m }}</li> }
                    </ul>
                  }
                  @if (e.expired) {
                    <a class="link" routerLink="/forgot-password">Request a new code</a>
                  }
                </span>
              </div>
            }
          </div>
          <a class="back" routerLink="/login"><app-icon name="arrow-left" />Back to sign in</a>
        </form>
      } @else {
        <div class="done" role="status">
          <span class="t-success-check" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <circle class="check-bg" cx="24" cy="24" r="23" />
              <path d="M15 24.5 21 30.5 33 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <div class="form-head">
            <h1>Password updated</h1>
            <p>Sign in with your new password. Other sessions on this account were signed out.</p>
          </div>
          <a class="btn primary block" routerLink="/login">Back to sign in</a>
        </div>
      }

      <app-auth-steps aside [current]="3" />
    </app-auth-layout>
  `,
})
export class ResetPassword {
  private readonly store = inject(Store);
  private readonly auth = inject(AuthService);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private readonly reset = this.auth.readResetToken();
  /** Arrived from a sign-in refused with 403 4020 (password expired). */
  protected readonly expired = !!(history.state as { expired?: unknown } | null)?.expired;

  constructor() {
    loadPolicy(inject(SettingsApi), this.store);
  }

  protected readonly email = signal<string>(this.reset?.email ?? '');
  protected readonly pw = signal('');
  protected readonly confirm = signal('');
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly tried = signal(false);
  /** The server refused the pair as different (400 4013). */
  protected readonly serverMismatch = signal(false);
  protected readonly error = signal<{ message: string; list: string[]; expired: boolean } | null>(null);

  protected readonly rules = computed<Rule[]>(() => {
    const p = this.store.settings().password;
    const v = this.pw();
    const out: Rule[] = [{ id: 'len', label: `At least ${p.minLength} characters`, ok: v.length >= p.minLength }];
    if (p.requireNumber) out.push({ id: 'num', label: 'Contains a number', ok: /\d/.test(v) });
    if (p.requireSymbol) out.push({ id: 'sym', label: 'Contains a symbol, like ! # or %', ok: /[^A-Za-z0-9\s]/.test(v) });
    out.push({ id: 'match', label: 'Both passwords match', ok: !!v && v === this.confirm() });
    return out;
  });
  protected readonly valid = computed(() => this.rules().every((r) => r.ok));
  /** Only complain about the confirmation once it is as long as the password. */
  protected readonly mismatch = computed(
    () => (this.tried() || this.confirm().length >= this.pw().length) && !!this.confirm() && this.confirm() !== this.pw(),
  );

  protected async submit(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    this.error.set(null);
    if (!this.valid()) {
      const f = this.form()?.nativeElement;
      if (f) replayShake(f);
      return;
    }
    if (!this.reset) return;
    this.busy.set(true);
    try {
      await this.auth.resetPassword(this.reset.token, this.pw(), this.confirm());
    } catch (err) {
      this.busy.set(false);
      this.showError(err);
      const f = this.form()?.nativeElement;
      if (f) replayShake(f);
      return;
    }
    // Drop both values from memory as soon as the request has succeeded; the token is single use.
    this.auth.clearResetToken();
    this.pw.set('');
    this.confirm.set('');
    this.busy.set(false);
    this.done.set(true);
  }

  private showError(err: unknown) {
    if (!(err instanceof AuthError)) {
      this.error.set({ message: NETWORK_ERROR_MESSAGE, list: [], expired: false });
      return;
    }
    if (err.code === AuthCode.PasswordMismatch) {
      this.serverMismatch.set(true);
      this.error.set({ message: err.message, list: [], expired: false });
      return;
    }
    if (err.code === AuthCode.PasswordWeak) {
      const raw = err.data?.['errors'];
      const list = Array.isArray(raw) ? raw.map(String) : [];
      this.error.set({ message: err.message, list, expired: false });
      return;
    }
    if (err.code === AuthCode.ResetTokenInvalid) {
      this.auth.clearResetToken();
      this.error.set({ message: err.message, list: [], expired: true });
      return;
    }
    this.error.set({ message: err.message, list: [], expired: false });
  }
}

/** Public screens read the rules from GET /settings/password-policy/; the defaults stay if it fails. */
export function loadPolicy(api: SettingsApi, store: Store) {
  api.passwordPolicy().then(
    (password) => store.settings.update((s) => ({ ...s, password })),
    () => undefined,
  );
}
