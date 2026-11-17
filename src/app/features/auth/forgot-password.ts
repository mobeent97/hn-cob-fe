import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCode, AuthError, NETWORK_ERROR_MESSAGE } from '../../core/auth/auth.models';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { AuthSteps } from './auth-steps';
import { OtpInput } from './otp-input';
import { replayShake } from './shake';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER = 30;

/**
 * Forgot password — "How do I get back in?"
 * Step 1 asks for the email (POST /auth/forgot-password/, which always succeeds so it never reveals
 * whether an account exists), step 2 for the emailed 6-digit code (POST /auth/forgot-password/verify/).
 * A right code returns a single-use reset token, kept in sessionStorage for /reset-password.
 */
@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink, Icon, AuthLayout, AuthSteps, OtpInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./auth-form.css', './forgot-password.css'],
  template: `
    <app-auth-layout asideLabel="Steps to reset your password">
      <div class="steps" [attr.data-step]="step()">
        <!-- Step 1: email -->
        <form class="pane auth-form t-shake" data-pane="1" #emailForm novalidate [inert]="step() !== 1" (submit)="send($event)">
          <div class="form-head">
            <h1>Forgot your password?</h1>
            <p>Enter your work email and we'll send you a 6-digit code.</p>
          </div>
          <div class="field">
            <label for="fp-email">Email</label>
            <input #emailInput id="fp-email" class="ui-control ui-control-lg" type="email" autocomplete="username" inputmode="email" spellcheck="false"
                   [class.invalid]="tried() && emailError()" [attr.aria-invalid]="tried() && !!emailError()"
                   [value]="email()" (input)="email.set($any($event.target).value)" />
            @if (tried() && emailError()) {
              <span class="error">{{ emailError() }}</span>
            }
          </div>
          <button class="btn primary block" type="submit" [disabled]="busy()" [attr.aria-busy]="busy()">
            <span class="t-text-soft" [class.is-swapping]="busy()">
              <span class="t-text-soft-old" [attr.aria-hidden]="busy()">Send code</span>
              <span class="t-text-soft-new" [attr.aria-hidden]="!busy()">Sending…</span>
            </span>
          </button>
          <div aria-live="polite">
            @if (sendError()) {
              <p class="form-error" role="alert">
                <app-icon name="circle-x" />
                <span>{{ sendError() }}</span>
              </p>
            }
          </div>
          <a class="back" routerLink="/login"><app-icon name="arrow-left" />Back to sign in</a>
        </form>

        <!-- Step 2: code -->
        <form class="pane auth-form" data-pane="2" novalidate [inert]="step() !== 2" (submit)="verify($event)">
          <div class="form-head">
            <h1>Check your email</h1>
            <p>We sent a 6-digit code to <strong>{{ email().trim() }}</strong>.</p>
          </div>
          <div class="field">
            <span class="label" id="otp-label">Verification code</span>
            <div class="t-shake" #otpRow>
              <app-otp-input #otp [(digits)]="digits" [invalid]="!!codeError()" (edited)="codeError.set('')" (complete)="verify()" />
            </div>
          </div>
          <button class="btn primary block" type="submit" [disabled]="busy() || !complete() || locked()" [attr.aria-busy]="busy()">
            <span class="t-text-soft" [class.is-swapping]="busy()">
              <span class="t-text-soft-old" [attr.aria-hidden]="busy()">Verify code</span>
              <span class="t-text-soft-new" [attr.aria-hidden]="!busy()">Verifying…</span>
            </span>
          </button>
          <div aria-live="polite">
            @if (codeError()) {
              <p class="form-error" role="alert">
                <app-icon name="circle-x" />
                <span>
                  {{ codeError() }}
                  @if (locked()) {
                    <button type="button" class="link link-btn" (click)="resend()">Send a new code</button>
                  }
                </span>
              </p>
            }
          </div>
          <p class="resend num" aria-live="polite">
            @if (left() > 0) {
              Didn't get it? You can resend in 0:{{ pad(left()) }}
            } @else {
              Didn't get it? <button type="button" class="link link-btn" (click)="resend()">Send a new code</button>
            }
            @if (resent()) { <span class="sr-only">A new code was sent.</span> }
          </p>
          <button type="button" class="back link-btn" (click)="goTo(1)"><app-icon name="arrow-left" />Use a different email</button>
        </form>
      </div>

      <app-auth-steps aside [current]="step()" />
    </app-auth-layout>
  `,
})
export class ForgotPassword {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly emailForm = viewChild.required<ElementRef<HTMLFormElement>>('emailForm');
  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('emailInput');
  private readonly otpRow = viewChild.required<ElementRef<HTMLDivElement>>('otpRow');
  private readonly otp = viewChild.required(OtpInput);

  protected readonly step = signal<1 | 2>(1);
  protected readonly email = signal<string>((history.state?.email as string | undefined) ?? '');
  protected readonly digits = signal<string[]>(['', '', '', '', '', '']);
  protected readonly busy = signal(false);
  protected readonly tried = signal(false);
  /** Message under the code boxes; empty when the code hasn't been refused. */
  protected readonly codeError = signal('');
  /** Too many wrong codes (429 4012): this code is dead, only a new one helps. */
  protected readonly locked = signal(false);
  protected readonly sendError = signal('');
  protected readonly left = signal(0);
  protected readonly resent = signal(false);
  protected readonly complete = computed(() => this.digits().every(Boolean));

  protected readonly emailError = computed(() => {
    const e = this.email().trim();
    if (!e) return 'Enter your email.';
    if (!EMAIL.test(e)) return 'Enter an email like name@company.com.';
    return '';
  });

  private countdown?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.countdown));
  }

  protected pad(n: number) {
    return String(n).padStart(2, '0');
  }

  protected goTo(step: 1 | 2) {
    this.step.set(step);
    this.busy.set(false);
    // Move focus into the step that just arrived, once it is no longer inert.
    queueMicrotask(() =>
      setTimeout(() => (step === 1 ? this.emailInput().nativeElement.focus() : this.otp().focus(0))),
    );
  }

  protected async send(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    this.sendError.set('');
    if (this.emailError()) {
      replayShake(this.emailForm().nativeElement);
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.forgotPassword(this.email().trim());
    } catch (err) {
      // 429: asked too often; anything else (offline, server down) is also said here, on step 1.
      this.busy.set(false);
      this.sendError.set(messageOf(err));
      replayShake(this.emailForm().nativeElement);
      return;
    }
    this.resetCode();
    this.startCountdown();
    this.goTo(2);
  }

  protected async resend() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.forgotPassword(this.email().trim());
    } catch (err) {
      this.busy.set(false);
      this.codeError.set(messageOf(err));
      return;
    }
    this.busy.set(false);
    this.resetCode();
    this.resent.set(true);
    this.startCountdown();
    this.otp().focus(0);
  }

  private resetCode() {
    this.digits.set(['', '', '', '', '', '']);
    this.codeError.set('');
    this.locked.set(false);
  }

  /** One interval at a time: a new countdown always clears the previous one. */
  private startCountdown() {
    clearInterval(this.countdown);
    this.left.set(RESEND_AFTER);
    this.countdown = setInterval(() => {
      this.left.update((n) => Math.max(0, n - 1));
      if (this.left() === 0) clearInterval(this.countdown);
    }, 1000);
  }

  protected async verify(ev?: Event) {
    ev?.preventDefault();
    if (this.busy() || !this.complete() || this.locked()) return;
    this.busy.set(true);
    const email = this.email().trim();
    try {
      const token = await this.auth.verifyCode(email, this.digits().join(''));
      this.auth.stashResetToken(token, email);
    } catch (err) {
      this.busy.set(false);
      this.codeError.set(codeMessage(err));
      this.locked.set(err instanceof AuthError && err.httpStatus === 429);
      replayShake(this.otpRow().nativeElement);
      return;
    }
    clearInterval(this.countdown);
    await this.router.navigate(['/reset-password']);
  }
}

function messageOf(err: unknown) {
  return err instanceof AuthError ? err.message : NETWORK_ERROR_MESSAGE;
}

/** 4011 keeps the familiar copy and says how many tries are left; 4012 asks for a new code. */
function codeMessage(err: unknown) {
  if (!(err instanceof AuthError)) return NETWORK_ERROR_MESSAGE;
  if (err.code === AuthCode.WrongCode || (err.httpStatus === 400 && err.data?.['attempts_left'] !== undefined)) {
    const left = Number(err.data?.['attempts_left']);
    const tail = Number.isFinite(left) ? ` ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` : '';
    return `That code isn't right. Check the latest email from HyperNym, or send a new code.${tail}`;
  }
  if (err.httpStatus === 429) return 'Too many wrong codes. Send a new code to try again.';
  return err.message;
}
