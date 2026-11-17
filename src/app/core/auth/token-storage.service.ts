import { Injectable } from '@angular/core';

const ACCESS_KEY = 'hn_cob_access';
const REFRESH_KEY = 'hn_cob_refresh';

/**
 * Keeps the JWT pair (access + refresh) between visits. Passwords are never stored anywhere;
 * "Remember my email" on the sign-in page keeps only the email (see features/auth/login.ts).
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  get accessToken(): string | null {
    return read(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return read(REFRESH_KEY);
  }

  /** Saves both tokens; refresh rotates them, so callers always pass the pair. */
  save(access: string, refresh: string): void {
    try {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* storage blocked: the session lasts for this tab only */
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  hasTokens(): boolean {
    return !!this.accessToken && !!this.refreshToken;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
