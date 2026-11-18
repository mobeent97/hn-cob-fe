import { Injectable } from '@angular/core';

/** `deleteToken()` on sign-out is best effort and never holds the user up longer than this. */
export const FORGET_CAP_MS = 1500;

/**
 * This browser's push registration as AuthService sees it, with no dependencies of its own (PushService
 * depends on AuthService, so AuthService can't depend on PushService). PushService fills `token` once it
 * has one and sets `forgetter`; sign-out sends the token as `push_token` and then calls `forget()`.
 */
@Injectable({ providedIn: 'root' })
export class PushDevice {
  /** The FCM token registered for the signed-in user on this browser, or null. Never logged. */
  token: string | null = null;
  forgetter: (() => Promise<void>) | null = null;

  /** Calls Firebase's `deleteToken()` through PushService, capped at 1.5 s; never throws. */
  async forget(capMs = FORGET_CAP_MS): Promise<void> {
    const fn = this.forgetter;
    this.token = null;
    if (!fn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([fn(), new Promise<void>((resolve) => (timer = setTimeout(resolve, capMs)))]);
    } catch {
      /* best effort */
    } finally {
      clearTimeout(timer);
    }
  }
}
