import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { TokenStorageService } from '../services/token-storage.service';

/**
 * Attaches auth headers to requests going to the backend.
 * Header names match the backend's CORS_ALLOW_HEADERS (authorization, x-refresh-token).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const tokens = inject(TokenStorageService);
  const headers: Record<string, string> = {};
  if (tokens.accessToken) headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  if (tokens.refreshToken) headers['X-Refresh-Token'] = tokens.refreshToken;

  // withCredentials pairs with the backend's CORS_ALLOW_CREDENTIALS = True.
  return next(req.clone({ setHeaders: headers, withCredentials: true }));
};
