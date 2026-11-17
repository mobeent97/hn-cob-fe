import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCode, AuthError } from '../../core/auth/auth.models';
import { SessionLoader } from '../../core/auth/session-loader';
import { safeReturnUrl } from '../../core/auth/auth.guard';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { Globe } from './globe';
import { replayShake } from './shake';

/** Only the email is remembered, never the password (the legacy portal stored an encrypted one). */
export const REMEMBER_KEY = 'hn.cob.rememberedEmail';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in — "Let me in, or tell me plainly why not."
 * POST /auth/login/ (AuthService). 401/403/423 show the server's message inline; 423 says when
 * the lock ends. The password is sent once (over TLS outside local dev) and is never stored or
 * encrypted on the client.
 */
@Component({
  selector: 'app-login',
  imports: [RouterLink, Icon, AuthLayout, Globe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.css',
  template: `
    <app-auth-layout asideLabel="Fleet activity">
      <form class="auth-form t-shake" #form novalidate (submit)="submit($event)">
        <div class="form-head">
          <h1>Sign in to Onboarding</h1>
          <p>Use your HyperNym work account.</p>
        </div>

        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="ui-control ui-control-lg" type="email" autocomplete="username" inputmode="email" spellcheck="false"
                 [class.invalid]="tried() && emailError()" [attr.aria-invalid]="tried() && !!emailError()"
                 [attr.aria-describedby]="tried() && emailError() ? 'email-err' : null"
                 [value]="email()" (input)="email.set($any($event.target).value); error.set('')" />
          @if (tried() && emailError()) {
            <span class="error" id="email-err">{{ emailError() }}</span>
          }
        </div>

        <div class="field">
          <label for="password">Password</label>
          <div class="pw">
            <input id="password" class="ui-control ui-control-lg" [type]="show() ? 'text' : 'password'" autocomplete="current-password"
                   [class.invalid]="tried() && !password()" [attr.aria-invalid]="tried() && !password()"
                   [value]="password()" (input)="password.set($any($event.target).value); error.set('')" />
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
              <span>{{ error() }}</span>
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
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionLoader);
  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');

  /** After /set-password the email arrives in the navigation state (never in the URL). */
  protected readonly email = signal(stateEmail() ?? localStorage.getItem(REMEMBER_KEY) ?? '');
  protected readonly password = signal('');
  protected readonly remember = signal(!!localStorage.getItem(REMEMBER_KEY));
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  /** The message under the button; empty when there is nothing to say. */
  protected readonly error = signal('');
  protected readonly tried = signal(false);

  protected readonly emailError = computed(() => {
    const e = this.email().trim();
    if (!e) return 'Enter your email.';
    if (!EMAIL.test(e)) return 'Enter an email like name@company.com.';
    return '';
  });

  protected async submit(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    this.error.set('');
    if (this.emailError() || !this.password()) {
      replayShake(this.form().nativeElement);
      return;
    }
    // Remember only the email; unticking clears it (the legacy portal never cleared it).
    if (this.remember()) localStorage.setItem(REMEMBER_KEY, this.email().trim());
    else localStorage.removeItem(REMEMBER_KEY);

    this.busy.set(true);
    try {
      await this.auth.login(this.email().trim(), this.password());
      this.password.set('');
      await this.session.load();
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
    } catch (err) {
      // 403 4020: right password, but it has expired. Choose a new one with the token the server returned.
      if (err instanceof AuthError && err.code === AuthCode.PasswordExpired && typeof err.data?.['reset_token'] === 'string') {
        this.password.set('');
        this.auth.stashResetToken(err.data['reset_token'] as string, this.email().trim());
        await this.router.navigate(['/reset-password'], { state: { expired: true } });
        return;
      }
      // A refused sign-in empties the password; a network failure keeps it for another try.
      if (!(err instanceof AuthError) || !err.isNetwork) {
        this.password.set('');
        this.tried.set(false);
      }
      this.error.set(loginMessage(err));
      replayShake(this.form().nativeElement);
    } finally {
      this.busy.set(false);
    }
  }
}

function stateEmail(): string | null {
  const e = (history.state as { email?: unknown } | null)?.email;
  return typeof e === 'string' && e ? e : null;
}

/** 423 names the time the lock ends; everything else shows the server's own message. */
function loginMessage(err: unknown): string {
  if (!(err instanceof AuthError)) return 'Something went wrong. Try again.';
  if (err.httpStatus === 423) {
    const until = new Date(String(err.data?.['locked_until'] ?? ''));
    if (!isNaN(until.getTime())) {
      const hhmm = until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      return `Too many attempts. Try again at ${hhmm}.`;
    }
  }
  return err.message;
}
