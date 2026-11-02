import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { AuthSteps } from './auth-steps';
import { OtpInput } from './otp-input';
import { replayShake } from './shake';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER = 30;

/**
 * Forgot password — "How do I get back in?"
 * Step 1 asks for the email, step 2 for the emailed 6-digit code; a right code opens
 * /reset-password. Design phase: any code works except 000000.
 */
@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink, Icon, AuthLayout, AuthSteps, OtpInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  styles: `
    // Side-by-side step slide (transitions.dev 08): 8px + fade + 3px blur, 250ms, direction-aware.
    .steps {
      display: grid;
    }
    .pane {
      grid-area: 1 / 1;
      opacity: 0;
      filter: blur(3px);
      visibility: hidden;
      transition:
        opacity 250ms var(--ease-out),
        transform 250ms var(--ease-out),
        filter 250ms var(--ease-out),
        visibility 0s linear 250ms;
    }
    .pane[data-pane='1'] {
      transform: translateX(-8px);
    }
    .pane[data-pane='2'] {
      transform: translateX(8px);
    }
    .steps[data-step='1'] .pane[data-pane='1'],
    .steps[data-step='2'] .pane[data-pane='2'] {
      opacity: 1;
      filter: blur(0);
      transform: none;
      visibility: visible;
      transition-delay: 0s;
    }
    .resend {
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .link-btn {
      border: 0;
      background: none;
      padding: 0;
      font: inherit;
    }
    @media (prefers-reduced-motion: reduce) {
      .pane {
        transition: none !important;
        transform: none !important;
        filter: none !important;
      }
    }
  `,
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
            <input #emailInput id="fp-email" class="input" type="email" autocomplete="username" inputmode="email" spellcheck="false"
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
              <app-otp-input #otp [(digits)]="digits" [invalid]="codeError()" (edited)="codeError.set(false)" (complete)="verify()" />
            </div>
          </div>
          <button class="btn primary block" type="submit" [disabled]="busy() || !complete()" [attr.aria-busy]="busy()">
            <span class="t-text-soft" [class.is-swapping]="busy()">
              <span class="t-text-soft-old" [attr.aria-hidden]="busy()">Verify code</span>
              <span class="t-text-soft-new" [attr.aria-hidden]="!busy()">Verifying…</span>
            </span>
          </button>
          <div aria-live="polite">
            @if (codeError()) {
              <p class="form-error" role="alert">
                <app-icon name="circle-x" />
                <span>That code isn't right. Check the latest email from HyperNym, or send a new code.</span>
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
  private readonly emailForm = viewChild.required<ElementRef<HTMLFormElement>>('emailForm');
  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('emailInput');
  private readonly otpRow = viewChild.required<ElementRef<HTMLDivElement>>('otpRow');
  private readonly otp = viewChild.required(OtpInput);

  protected readonly step = signal<1 | 2>(1);
  protected readonly email = signal<string>((history.state?.email as string | undefined) ?? '');
  protected readonly digits = signal<string[]>(['', '', '', '', '', '']);
  protected readonly busy = signal(false);
  protected readonly tried = signal(false);
  protected readonly codeError = signal(false);
  protected readonly left = signal(0);
  protected readonly resent = signal(false);
  protected readonly complete = computed(() => this.digits().every(Boolean));

  protected readonly emailError = computed(() => {
    const e = this.email().trim();
    if (!e) return 'Enter your email.';
    if (!EMAIL.test(e)) return 'Enter an email like name@company.com.';
    return '';
  });

  private timer?: ReturnType<typeof setTimeout>;
  private countdown?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      clearInterval(this.countdown);
    });
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

  protected send(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    if (this.emailError()) {
      replayShake(this.emailForm().nativeElement);
      return;
    }
    this.busy.set(true);
    this.timer = setTimeout(() => {
      this.digits.set(['', '', '', '', '', '']);
      this.codeError.set(false);
      this.startCountdown();
      this.goTo(2);
    }, 700);
  }

  protected resend() {
    this.digits.set(['', '', '', '', '', '']);
    this.codeError.set(false);
    this.resent.set(true);
    this.startCountdown();
    this.otp().focus(0);
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

  protected verify(ev?: Event) {
    ev?.preventDefault();
    if (this.busy() || !this.complete()) return;
    this.busy.set(true);
    const code = this.digits().join('');
    this.timer = setTimeout(() => {
      this.busy.set(false);
      if (code === '000000') {
        this.codeError.set(true);
        replayShake(this.otpRow().nativeElement);
        return;
      }
      clearInterval(this.countdown);
      void this.router.navigate(['/reset-password'], { state: { email: this.email().trim() } });
    }, 700);
  }
}
