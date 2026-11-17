import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService, SILENT_AUTH_FAILURE, SKIP_AUTH_REFRESH } from './auth.service';
import { AuthCode } from './auth.models';
import { TokenStorageService } from './token-storage.service';

/** Endpoints that are called without a token (AUTH_API.md and USERS_API.md: Auth "—"; SETTINGS_API password policy). */
const PUBLIC_PATHS = [
  '/auth/login/', '/auth/refresh-token/', '/auth/forgot-password/', '/auth/reset-password/', '/auth/set-password/',
  '/settings/password-policy/',
];

const isApi = (url: string) => url.startsWith(environment.apiUrl);
const isPublic = (url: string) => {
  const path = url.slice(environment.apiUrl.length).split('?')[0];
  return PUBLIC_PATHS.some((p) => path.startsWith(p));
};
const withBearer = (req: HttpRequest<unknown>, token: string) =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

/**
 * Sends `Authorization: Bearer <access>` to our API only (never to map tiles or other hosts), and not
 * to the public auth endpoints. JWTs travel in the header, so no cookies or withCredentials.
 *
 * A 401 `4005` on an authenticated call (user or organization no longer allowed, idle timeout) clears the
 * session and goes to /login at once. Any other 401 on an authenticated call refreshes the tokens once (shared by concurrent calls) and retries
 * with the new access token. If the refresh fails, the session is cleared and the user is sent to
 * /login?returnUrl=<where they were>.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req.url) || isPublic(req.url)) return next(req);

  const tokens = inject(TokenStorageService);
  const auth = inject(AuthService);
  const router = inject(Router);
  const sent = tokens.accessToken;
  if (!sent) return next(req);

  return next(withBearer(req, sent)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || req.context.get(SKIP_AUTH_REFRESH)) {
        return throwError(() => err);
      }
      const signOut = () => {
        auth.clearSession();
        if (!req.context.get(SILENT_AUTH_FAILURE)) {
          const returnUrl = router.url && !router.url.startsWith('/login') ? router.url : undefined;
          void router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : {} });
        }
      };
      // 401 4005: the user or organization is no longer allowed, or the idle timeout was reached.
      // A refresh can't fix that (it doesn't extend the idle timer): sign in again.
      if ((err.error as { status?: unknown } | null)?.status === AuthCode.RefreshInvalid) {
        signOut();
        return throwError(() => err);
      }
      // Another call already refreshed while this one was in flight: just retry with the newer token.
      const current = tokens.accessToken;
      const fresh$ = current && current !== sent ? of(current) : auth.refresh();

      return fresh$.pipe(
        catchError((refreshErr: unknown) => {
          signOut();
          return throwError(() => refreshErr);
        }),
        // Retry once; a second 401 is passed on as is.
        switchMap((token) => next(withBearer(req, token))),
      );
    }),
  );
};
