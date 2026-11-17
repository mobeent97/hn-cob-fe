import { HttpClient, HttpContext, HttpContextToken, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Store } from '../data/store';
import {
  ApiEnvelope, AuthError, AuthUser, ForgotPasswordData, LoginData, MeAccess, NETWORK_ERROR_MESSAGE, SetPasswordInfo, TokenPair,
  VerifyCodeData,
} from './auth.models';
import { TokenStorageService } from './token-storage.service';

/** Set on a request to stop the interceptor refreshing and retrying it after a 401 (logout uses it). */
export const SKIP_AUTH_REFRESH = new HttpContextToken<boolean>(() => false);
/** Set on a request whose 401 may refresh and retry, but must not send the user to /login if that fails. */
export const SILENT_AUTH_FAILURE = new HttpContextToken<boolean>(() => false);

const RESET_TOKEN_KEY = 'hn.cob.resetToken';
const RESET_EMAIL_KEY = 'hn.cob.resetEmail';

/**
 * Session state and every Auth API v1 call (hn-cob-be/docs/AUTH_API.md).
 * Screens await the Promise-returning methods; the interceptor uses `refresh()`, an Observable that
 * concurrent 401s share so the rotating refresh token is only spent once.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStorageService);
  private readonly store = inject(Store);
  private readonly base = `${environment.apiUrl}/auth`;

  private readonly _user = signal<AuthUser | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user());

  private refreshInFlight: Observable<string> | null = null;
  private restoring: Promise<void> | null = null;

  async login(email: string, password: string): Promise<AuthUser> {
    const data = await this.call(this.http.post<ApiEnvelope<LoginData>>(`${this.base}/login/`, { email, password }));
    this.tokens.save(data.access, data.refresh);
    this.setUser(data.user);
    return data.user;
  }

  /**
   * Swaps the refresh token for a new pair and emits the new access token.
   * Callers that arrive while a refresh is running share that one request.
   */
  refresh(): Observable<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refresh = this.tokens.refreshToken;
    if (!refresh) return throwError(() => new AuthError(401, null, 'Your session has ended. Sign in again.'));

    this.refreshInFlight = this.http.post<ApiEnvelope<TokenPair>>(`${this.base}/refresh-token/`, { refresh }).pipe(
      map((res) => res.data),
      tap((pair) => this.tokens.save(pair.access, pair.refresh)),
      map((pair) => pair.access),
      catchError((err) => throwError(() => toAuthError(err))),
      finalize(() => (this.refreshInFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshInFlight;
  }

  /** Revokes the refresh token on the server, then always clears the local session, even if that call fails. */
  async logout(): Promise<void> {
    const refresh = this.tokens.refreshToken;
    try {
      if (refresh) {
        await firstValueFrom(
          this.http.post(`${this.base}/logout/`, { refresh }, { context: new HttpContext().set(SKIP_AUTH_REFRESH, true) }),
        );
      }
    } catch {
      /* the server may already consider the token dead; signing out locally is what matters */
    } finally {
      this.clearSession();
    }
  }

  /** Fetches the signed-in user with the stored tokens. */
  async loadMe(): Promise<AuthUser> {
    const user = await this.call(
      this.http.get<ApiEnvelope<AuthUser>>(`${this.base}/me/`, { context: new HttpContext().set(SILENT_AUTH_FAILURE, true) }),
    );
    this.setUser(user);
    return user;
  }

  /** App start: restore the session when tokens exist; any failure just clears them. Runs once. */
  restoreSession(): Promise<void> {
    this.restoring ??= this.tokens.hasTokens()
      ? this.loadMe().then(
          () => undefined,
          () => this.clearSession(),
        )
      : Promise.resolve();
    return this.restoring;
  }

  /** Always succeeds for a well-formed email (the API never reveals whether the account exists). */
  forgotPassword(email: string): Promise<ForgotPasswordData> {
    return this.call(this.http.post<ApiEnvelope<ForgotPasswordData>>(`${this.base}/forgot-password/`, { email }));
  }

  /** Trades the emailed 6-digit code for a single-use reset token. */
  async verifyCode(email: string, code: string): Promise<string> {
    const data = await this.call(
      this.http.post<ApiEnvelope<VerifyCodeData>>(`${this.base}/forgot-password/verify/`, { email, code }),
    );
    return data.reset_token;
  }

  async resetPassword(resetToken: string, newPassword: string, confirmPassword: string): Promise<void> {
    await this.call(
      this.http.post<ApiEnvelope<unknown>>(`${this.base}/reset-password/`, {
        reset_token: resetToken,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    );
  }

  // ── My account (USERS_API "/auth/me/…") ──
  /** The server's effective access per feature; Access uses it as the answer. */
  async loadAccess(): Promise<MeAccess> {
    const access = await this.call(this.http.get<ApiEnvelope<MeAccess>>(`${this.base}/me/access/`));
    this.store.access.set(access);
    return access;
  }

  /** Saves my name and phone; the session picks up the new details. */
  async updateMe(body: { full_name?: string; phone?: string }): Promise<AuthUser> {
    const user = await this.call(this.http.patch<ApiEnvelope<AuthUser>>(`${this.base}/me/`, body));
    this.setUser(user);
    return user;
  }

  /** Other sessions are signed out; this one continues with the returned pair. */
  async changePassword(current: string, next: string, confirm: string): Promise<void> {
    const pair = await this.call(
      this.http.post<ApiEnvelope<TokenPair>>(`${this.base}/me/change-password/`, {
        current_password: current,
        new_password: next,
        confirm_password: confirm,
      }),
    );
    this.tokens.save(pair.access, pair.refresh);
  }

  // ── Set-password links (public): invitations and admin-triggered resets ──
  verifySetPasswordLink(token: string): Promise<SetPasswordInfo> {
    return this.call(this.http.post<ApiEnvelope<SetPasswordInfo>>(`${this.base}/set-password/verify/`, { token }));
  }

  async setPassword(token: string, newPassword: string, confirmPassword: string): Promise<void> {
    await this.call(
      this.http.post<ApiEnvelope<unknown>>(`${this.base}/set-password/`, {
        token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    );
  }

  /** Forgets the tokens and the user locally (no server call). */
  clearSession(): void {
    this.tokens.clear();
    this._user.set(null);
    this.store.setSession(null);
  }

  // ── Reset token hand-off between /forgot-password and /reset-password (this tab only) ──
  stashResetToken(token: string, email: string) {
    try {
      sessionStorage.setItem(RESET_TOKEN_KEY, token);
      sessionStorage.setItem(RESET_EMAIL_KEY, email);
    } catch {
      /* storage blocked: the reset page will send the user back to request a code */
    }
  }

  readResetToken(): { token: string; email: string } | null {
    try {
      const token = sessionStorage.getItem(RESET_TOKEN_KEY);
      return token ? { token, email: sessionStorage.getItem(RESET_EMAIL_KEY) ?? '' } : null;
    } catch {
      return null;
    }
  }

  clearResetToken() {
    try {
      sessionStorage.removeItem(RESET_TOKEN_KEY);
      sessionStorage.removeItem(RESET_EMAIL_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  private setUser(user: AuthUser) {
    this._user.set(user);
    // The store derives the session (current user, organization, tenant scope, access) from the real user.
    this.store.setSession(user);
  }

  /** Unwraps the envelope's data, mapping any failure to an AuthError. */
  private async call<T>(req: Observable<ApiEnvelope<T>>): Promise<T> {
    try {
      return (await firstValueFrom(req)).data;
    } catch (err) {
      throw toAuthError(err);
    }
  }
}

/** HTTP failure → AuthError carrying the envelope's message (or a plain fallback). */
export function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return new AuthError(0, null, NETWORK_ERROR_MESSAGE);
    const body = err.error as Partial<ApiEnvelope<Record<string, unknown> | null>> | null;
    const envelope = body && typeof body === 'object' ? body : null;
    const message =
      typeof envelope?.message === 'string' && envelope.message
        ? envelope.message
        : `Something went wrong (HTTP ${err.status}). Try again.`;
    const code = typeof envelope?.status === 'number' ? envelope.status : null;
    const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : null;
    return new AuthError(err.status, code, message, data);
  }
  return new AuthError(0, null, NETWORK_ERROR_MESSAGE);
}
