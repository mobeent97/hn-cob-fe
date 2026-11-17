import { DestroyRef, Injectable, inject } from '@angular/core';
import { Store } from '../data/store';
import { OrganizationsApi } from '../api/organizations.api';
import { SettingsApi } from '../api/settings.api';
import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';

/** Window focus refreshes access at most this often. */
const FOCUS_REFRESH_MS = 30_000;

/**
 * What every screen needs once someone is signed in (USERS_API, SETTINGS_API and ORGANIZATIONS_API
 * "App start"): their effective access, the portal settings (page size, password rules) and the
 * organizations they can see. Called by the app initializer after the session is restored and by the
 * sign-in screen after a login; each part fails on its own without blocking the others.
 */
@Injectable({ providedIn: 'root' })
export class SessionLoader {
  private readonly auth = inject(AuthService);
  private readonly store = inject(Store);
  private readonly settings = inject(SettingsApi);
  private readonly orgs = inject(OrganizationsApi);
  private readonly log = inject(LoggerService);
  private lastAccess = 0;

  constructor() {
    const onFocus = () => {
      if (this.auth.isAuthenticated() && Date.now() - this.lastAccess > FOCUS_REFRESH_MS) void this.refreshAccess();
    };
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  async load(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    await Promise.all([this.refreshAccess(), this.refreshSettings(), this.refreshOrganizations()]);
  }

  /** GET /auth/me/access/. After role or entitlement saves too; a failure keeps the local fallback. */
  async refreshAccess(): Promise<void> {
    this.lastAccess = Date.now();
    try {
      await this.auth.loadAccess();
    } catch (err) {
      this.log.warn('Could not load access levels', err);
    }
  }

  async refreshSettings(): Promise<void> {
    try {
      this.store.settings.set(await this.settings.get());
    } catch (err) {
      this.log.warn('Could not load portal settings', err);
    }
  }

  /** The scope switcher, organization pickers and the Roles matrix caps read these. */
  async refreshOrganizations(): Promise<void> {
    try {
      this.store.mergeOrganizations(await this.orgs.options());
    } catch (err) {
      this.log.warn('Could not load organizations', err);
    }
  }
}
