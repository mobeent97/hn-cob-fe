import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { Globe } from './globe';
import { replayShake } from './shake';

/** Only the email is remembered, never the password (the legacy portal stored an encrypted one). */
export const REMEMBER_KEY = 'hn.cob.rememberedEmail';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in — "Let me in, or tell me plainly why not."
 * Design phase: any credentials work except the password "wrong", which shows the error state.
 * The password is sent once (over TLS when the API exists) and is never stored or encrypted
 * on the client.
 */
@Component({
  selector: 'app-login',
  imports: [RouterLink, Icon, AuthLayout, Globe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-layout asideLabel="Fleet activity">
      <form class="auth-form t-shake" #form novalidate (submit)="submit($event)">
        <div class="form-head">
          <h1>Sign in to Onboarding</h1>
          <p>Use your HyperNym work account.</p>
        </div>

        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="ui-control" type="email" autocomplete="username" inputmode="email" spellcheck="false"
                 [class.invalid]="tried() && emailError()" [attr.aria-invalid]="tried() && !!emailError()"
                 [attr.aria-describedby]="tried() && emailError() ? 'email-err' : null"
                 [value]="email()" (input)="email.set($any($event.target).value); error.set(false)" />
          @if (tried() && emailError()) {
            <span class="error" id="email-err">{{ emailError() }}</span>
          }
        </div>

        <div class="field">
          <label for="password">Password</label>
          <div class="pw">
            <input id="password" class="ui-control" [type]="show() ? 'text' : 'password'" autocomplete="current-password"
                   [class.invalid]="tried() && !password()" [attr.aria-invalid]="tried() && !password()"
                   [value]="password()" (input)="password.set($any($event.target).value); error.set(false)" />
            <button type="button" class="reveal" (click)="show.set(!show())"
                    [attr.aria-label]="show() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="show()">
              <app-icon [name]="show() ? 'eye-off' : 'eye'" />
            </button>
          </div>
          @if (tried() && !password()) {
            <span class="error">Enter your password.</span>
          }
        </div>

        <div class="row-between">
          <label class="check">
            <input type="checkbox" [checked]="remember()" (change)="remember.set($any($event.target).checked)" />
            Remember my email
          </label>
          <a class="link" routerLink="/forgot-password" [state]="{ email: email() }">Forgot password?</a>
        </div>

        <button class="btn primary block" type="submit" [disabled]="busy()" [attr.aria-busy]="busy()">
          <span class="t-text-soft" [class.is-swapping]="busy()">
            <span class="t-text-soft-old" [attr.aria-hidden]="busy()">Sign in</span>
            <span class="t-text-soft-new" [attr.aria-hidden]="!busy()">Signing in…</span>
          </span>
        </button>

        <div aria-live="polite">
          @if (error()) {
            <p class="form-error" role="alert">
              <app-icon name="circle-x" />
              <span>That email and password don't match. Check both and try again, or reset your password.</span>
            </p>
          }
        </div>
      </form>

      <app-globe aside />
    </app-auth-layout>
  `,
})
export class Login {
  private readonly router = inject(Router);
  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly email = signal(localStorage.getItem(REMEMBER_KEY) ?? '');
  protected readonly password = signal('');
  protected readonly remember = signal(!!localStorage.getItem(REMEMBER_KEY));
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal(false);
  protected readonly tried = signal(false);

  protected readonly emailError = computed(() => {
    const e = this.email().trim();
    if (!e) return 'Enter your email.';
    if (!EMAIL.test(e)) return 'Enter an email like name@company.com.';
    return '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected submit(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    this.error.set(false);
    if (this.emailError() || !this.password()) {
      replayShake(this.form().nativeElement);
      return;
    }
    // Remember only the email; unticking clears it (the legacy portal never cleared it).
    if (this.remember()) localStorage.setItem(REMEMBER_KEY, this.email().trim());
    else localStorage.removeItem(REMEMBER_KEY);

    this.busy.set(true);
    this.timer = setTimeout(() => {
      this.busy.set(false);
      if (this.password() === 'wrong') {
        this.password.set('');
        this.tried.set(false);
        this.error.set(true);
        replayShake(this.form().nativeElement);
        return;
      }
      this.password.set('');
      void this.router.navigate(['/dashboard']);
    }, 900);
  }
}
