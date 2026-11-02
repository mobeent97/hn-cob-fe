import { Injectable } from '@angular/core';

const ACCESS_KEY = 'hn_cob_access';
const REFRESH_KEY = 'hn_cob_refresh';

@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  save(access: string, refresh?: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.accessToken;
  }
}
