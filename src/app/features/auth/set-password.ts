import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCode, AuthError, NETWORK_ERROR_MESSAGE, SetPasswordInfo } from '../../core/auth/auth.models';
import { SettingsApi } from '../../core/api/settings.api';
import { Icon } from '../../shared/ui/icon';
import { AuthLayout } from './auth-layout';
import { loadPolicy } from './reset-password';
import { replayShake } from './shake';
import { BrandTheme } from '../../core/theme/brand';
import { normalizeHex } from '../../core/theme/brand-scale';
import { OrgLogo } from '../../shared/ui/org-logo';

interface Rule {
  id: string;
  label: string;
  ok: boolean;
}

/**
 * Set your password — "Is this link still good, and does my password meet the policy?"
 * Opened from an invitation email or an admin-triggered reset link: `/set-password?token=<uidb64>.<token>`.
 * POST /auth/set-password/verify/ says what the link is for; POST /auth/set-password/ sets the password,
 * then the user signs in with the email filled in (passed in navigation state, never the URL).
 * Same look as /reset-password.
 */
@Component({
  selector: 'app-set-password',
  imports: [RouterLink, Icon, AuthLayout, OrgLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./auth-form.css', './reset-password.css'],
  template: `
    <app-auth-layout [asideLabel]="invite() ? 'Steps to join the portal' : 'Steps to reset your password'">
      @switch (phase()) {
        @case ('checking') {
          <div class="auth-form" aria-busy="true">
            <div class="form-head">
              <h1>Checking your link…</h1>
              <p><span class="skeleton" style="display:block;width:260px;height:14px"></span></p>
            </div>
            <span class="skeleton" style="display:block;width:100%;height:44px"></span>
            <span class="skeleton" style="display:block;width:100%;height:44px"></span>
          </div>
        }
        @case ('invalid') {
          <div class="auth-form">
            <div class="form-head">
              <h1>This link can't be used</h1>
              <p>Links work once and expire: an invitation after 7 days, a reset link after 24 hours.</p>
            </div>
            <p class="form-error" role="alert"><app-icon name="circle-x" /><span>{{ linkError() }}</span></p>
            @if (linkRetry()) {
              <button class="btn block" type="button" (click)="verify()">Try again</button>
            }
            <p class="muted-copy">Ask your administrator to send a new invitation, or reset your password yourself.</p>
            <a class="btn primary block" routerLink="/forgot-password">Reset my password</a>
            <a class="back" routerLink="/login"><app-icon name="arrow-left" />Back to sign in</a>
          </div>
        }
        @case ('form') {
          <form class="auth-form t-shake" #form novalidate (submit)="submit($event)">
            @if (orgBrand(); as b) {
              <div class="org-brand">
                <app-org-logo [url]="b.logoUrl" [name]="b.name" fallback="initials" [size]="40" />
                <span>{{ invite() ? 'Join ' + b.name : b.name }}</span>
              </div>
            }
            <div class="form-head">
              @if (invite()) {
                <h1>Welcome{{ firstName() ? ', ' + firstName() : '' }}</h1>
                <p>
                  Set a password to join @if (info()?.organization?.name; as org) { <strong>{{ org }}</strong> } @else { the portal }.
                  You'll sign in with <strong>{{ info()?.email }}</strong>.
                </p>
              } @else {
                <h1>Set a new password</h1>
                <p>For <strong>{{ info()?.email }}</strong>. You'll sign in with it from now on.</p>
              }
            </div>

            <!-- Lets password managers save the new password against the right account. -->
            <input class="sr-only" type="email" autocomplete="username" [value]="info()?.email ?? ''" readonly tabindex="-1" aria-hidden="true" />

            <div class="field">
              <label for="sp-new">{{ invite() ? 'Password' : 'New password' }}</label>
              <div class="pw">
                <input id="sp-new" class="ui-control ui-control-lg" [type]="show() ? 'text' : 'password'" autocomplete="new-password"
                       aria-describedby="sp-rules" [value]="pw()" (input)="pw.set($any($event.target).value)" />
                <button type="button" class="reveal" (click)="show.set(!show())"
                        [attr.aria-label]="show() ? 'Hide passwords' : 'Show passwords'" [attr.aria-pressed]="show()">
                  <app-icon [name]="show() ? 'eye-off' : 'eye'" />
                </button>
              </div>
            </div>

            <div class="field">
              <label for="sp-confirm">Confirm password</label>
              <input id="sp-confirm" class="ui-control ui-control-lg" [type]="show() ? 'text' : 'password'" autocomplete="new-password"
                     [class.invalid]="mismatch() || serverMismatch()" [value]="confirm()"
                     (input)="confirm.set($any($event.target).value); serverMismatch.set(false)" />
              @if (mismatch() || serverMismatch()) { <span class="error">The two passwords don't match yet.</span> }
            </div>

            <ul class="rules" id="sp-rules" aria-label="Password rules">
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
                <span class="t-text-soft-old" [attr.aria-hidden]="busy()">{{ invite() ? 'Set password' : 'Save new password' }}</span>
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
                  </span>
                </div>
              }
            </div>
            <a class="back" routerLink="/login"><app-icon name="arrow-left" />Back to sign in</a>
          </form>
        }
        @case ('done') {
          <div class="done" role="status">
            <span class="t-success-check" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 48 48">
                <circle class="check-bg" cx="24" cy="24" r="23" />
                <path d="M15 24.5 21 30.5 33 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <div class="form-head">
              <h1>Password set</h1>
              <p>Sign in with {{ info()?.email }} and your new password.</p>
            </div>
            <button class="btn primary block" type="button" (click)="toLogin()">Continue to sign in</button>
          </div>
        }
      }

      <div class="steps-aside" aside>
        <h2>{{ invite() ? 'Join the portal in three steps' : 'Reset your password in three steps' }}</h2>
        <ol>
          @for (s of steps(); track s.n) {
            <li [class.current]="s.n === step()" [class.done]="s.n < step()" [attr.aria-current]="s.n === step() ? 'step' : null">
              <span class="n num">{{ s.n }}</span>
              <strong>{{ s.title }}</strong>
              <small>{{ s.body }}</small>
            </li>
          }
        </ol>
      </div>
    </app-auth-layout>
  `,
  styles: `
    /* The inviting organization (BRANDING_MEDIA_EMAIL.md 1.5): its logo and name above the form. */
    .org-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .muted-copy {
      margin: 0;
      font-size: 0.75rem;
      color: var(--color-muted);
    }
  `,
})
export class SetPassword {
  private readonly store = inject(Store);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';

  protected readonly phase = signal<'checking' | 'invalid' | 'form' | 'done'>('checking');
  protected readonly info = signal<SetPasswordInfo | null>(null);
  protected readonly linkError = signal('');
  /** A network failure (not a dead link) can be retried. */
  protected readonly linkRetry = signal(false);
  protected readonly invite = computed(() => this.info()?.purpose !== 'reset');
  /** A partner's invitation or reset link shows that organization's brand; platform links keep HyperNym's. */
  protected readonly orgBrand = computed(() => {
    const org = this.info()?.organization;
    if (!org || org.kind === 'Platform' || !org.kind) return null;
    return { name: org.name, logoUrl: org.logo_url ?? null, colour: normalizeHex(org.brand_colour) };
  });
  private readonly brand = inject(BrandTheme);
  private releaseBrand: (() => void) | null = null;
  protected readonly firstName = computed(() => (this.info()?.full_name ?? '').split(/\s+/)[0] ?? '');

  protected readonly pw = signal('');
  protected readonly confirm = signal('');
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly tried = signal(false);
  protected readonly serverMismatch = signal(false);
  protected readonly error = signal<{ message: string; list: string[] } | null>(null);

  protected readonly step = computed(() => (this.phase() === 'done' ? 3 : 2));
  protected readonly steps = computed(() => {
    const p = this.store.settings().password;
    return [
      { n: 1, title: this.invite() ? 'Open your invitation' : 'Open the link we emailed', body: 'It works once.' },
      { n: 2, title: 'Choose a password', body: `At least ${p.minLength} characters.` },
      { n: 3, title: 'Sign in', body: 'With your work email and the new password.' },
    ];
  });

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
  protected readonly mismatch = computed(
    () => (this.tried() || this.confirm().length >= this.pw().length) && !!this.confirm() && this.confirm() !== this.pw(),
  );

  constructor() {
    loadPolicy(inject(SettingsApi), this.store);
    inject(DestroyRef).onDestroy(() => this.releaseBrand?.());
    void this.verify();
  }

  protected async verify() {
    this.phase.set('checking');
    this.linkRetry.set(false);
    if (!this.token) {
      this.linkError.set('This link is incomplete. Open it again from the email.');
      this.phase.set('invalid');
      return;
    }
    try {
      this.info.set(await this.auth.verifySetPasswordLink(this.token));
      // This page only: the inviting organization's scale (or the default for a platform link).
      this.releaseBrand?.();
      this.releaseBrand = this.brand.usePageBrand(this.orgBrand()?.colour ?? null);
      this.phase.set('form');
    } catch (err) {
      const e = err instanceof AuthError ? err : null;
      this.linkError.set(e?.message ?? NETWORK_ERROR_MESSAGE);
      this.linkRetry.set(!e || e.isNetwork || e.httpStatus >= 500);
      this.phase.set('invalid');
    }
  }

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
    this.busy.set(true);
    try {
      await this.auth.setPassword(this.token, this.pw(), this.confirm());
    } catch (err) {
      this.busy.set(false);
      this.showError(err);
      const f = this.form()?.nativeElement;
      if (f) replayShake(f);
      return;
    }
    this.pw.set('');
    this.confirm.set('');
    this.busy.set(false);
    this.phase.set('done');
  }

  protected toLogin() {
    void this.router.navigate(['/login'], { state: { email: this.info()?.email ?? '' } });
  }

  private showError(err: unknown) {
    if (!(err instanceof AuthError)) {
      this.error.set({ message: NETWORK_ERROR_MESSAGE, list: [] });
      return;
    }
    if (err.code === AuthCode.LinkInvalid) {
      this.linkError.set(err.message);
      this.phase.set('invalid');
      return;
    }
    if (err.code === AuthCode.PasswordMismatch) this.serverMismatch.set(true);
    const raw = err.data?.['errors'];
    this.error.set({ message: err.message, list: err.code === AuthCode.PasswordWeak && Array.isArray(raw) ? raw.map(String) : [] });
  }
}
