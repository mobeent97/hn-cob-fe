import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Only a same-app path is a safe place to return to after sign-in (no `//host` or absolute URLs). */
export function safeReturnUrl(url: string | null | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login') ? url : '/dashboard';
}

/** The signed-in app: without a session, go to /login and come back here afterwards. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** /login: a signed-in user goes straight to where they were heading, or the dashboard. */
export const guestGuard: CanActivateFn = (route) => {
  if (!inject(AuthService).isAuthenticated()) return true;
  return inject(Router).parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
};

/** /reset-password needs the token /forgot-password stored after a right code; without it, start over. */
export const resetTokenGuard: CanActivateFn = () =>
  inject(AuthService).readResetToken() ? true : inject(Router).createUrlTree(['/forgot-password']);
