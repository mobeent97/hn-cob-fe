import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
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
                   [class.invalid]="mismatch()" [value]="confirm()" (input)="confirm.set($any($event.target).value)" />
            @if (mismatch()) {
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
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly email = signal<string>((history.state?.email as string | undefined) ?? '');
  protected readonly pw = signal('');
  protected readonly confirm = signal('');
  protected readonly show = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly tried = signal(false);

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

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected submit(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    this.tried.set(true);
    if (!this.valid()) {
      const f = this.form()?.nativeElement;
      if (f) replayShake(f);
      return;
    }
    this.busy.set(true);
    this.timer = setTimeout(() => {
      // Drop both values from memory as soon as the (future) request is sent.
      this.pw.set('');
      this.confirm.set('');
      this.busy.set(false);
      this.done.set(true);
    }, 800);
  }
}
