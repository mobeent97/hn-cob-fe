import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { AuthService } from '../auth/auth.service';
import { LoggerService } from '../auth/logger.service';
import { AuthError } from '../auth/auth.models';
import { NotificationsApi, PushConfig, PushTokenBody } from '../api/notifications.api';
import { Toaster } from '../../shared/ui/toast';
import { NotificationCenter } from './notification-center';
import { PushDevice } from './push-device';
import { routeOf, takeOpenMarker } from './link';
import {
  PermissionState, PushEnv, PushState, afterPermission, currentPermission, detectEnv, deviceLabel, pushState,
} from './push-state';

/** Served from public/ at the root path, registered with FCM's narrow scope so it never controls page loads. */
export const SW_URL = '/firebase-messaging-sw.js';
export const SW_SCOPE = '/firebase-cloud-messaging-push-scope';
const FIREBASE_APP_NAME = 'hn-cob-push';
/** Re-register at most daily while in use (tokens unseen for 60 days are pruned). */
const REREGISTER_MS = 24 * 3600_000;
const flagKey = (userId: number) => `hn.push.on.${userId}`;
/** `{ u: userId, h: sha-256 of the token, at: ms }`: the last registration from this browser. */
const REG_KEY = 'hn.push.reg';

/** What the service worker posts to portal windows (public/firebase-messaging-sw.js). */
export interface PushPayload {
  notification_id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  tag: string;
  sent_at: string;
}

type Sdk = {
  app: typeof import('firebase/app');
  messaging: typeof import('firebase/messaging');
};

/**
 * Browser push through Firebase Cloud Messaging (PUSH_NOTIFICATIONS.md 6.3). The modular Firebase SDK is
 * loaded only when push is used, with the web config from GET /notifications/push/config/ (nothing at build
 * time). It never asks for permission by itself: only the switch on My profile does, on click.
 *
 * - App start / sign-in: with permission granted, the config enabled and this user's flag set, it gets the
 *   token and registers it when it changed or the last register is over 24 h old.
 * - `hn-push` from the worker: refresh the bell, and in the focused tab an info toast with Open.
 * - `hn-push-open` (a system notification was clicked): route in place and mark the row read.
 * - Sign-out: AuthService sends the token as `push_token`, then PushDevice calls `deleteToken()`.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(NotificationsApi);
  private readonly center = inject(NotificationCenter);
  private readonly device = inject(PushDevice);
  private readonly toast = inject(Toaster);
  private readonly router = inject(Router);
  private readonly log = inject(LoggerService);

  private readonly env: PushEnv = detectEnv();
  private readonly config = signal<PushConfig | null>(null);
  private readonly configState = signal<'loading' | 'enabled' | 'disabled'>('loading');
  private readonly sdkSupported = signal<boolean | null>(null);
  private readonly permission = signal<PermissionState>(currentPermission());
  private readonly flag = signal(false);
  /** The switch is working (permission prompt, token, register or unregister). */
  readonly busy = signal(false);
  readonly state = computed<PushState>(() =>
    pushState({
      config: this.configState(),
      env: this.env,
      sdkSupported: this.sdkSupported(),
      permission: this.permission(),
      flag: this.flag(),
    }),
  );

  private configLoad: Promise<PushConfig | null> | null = null;
  private sdk: Sdk | null = null;
  private messaging: Messaging | null = null;
  /** Notification ids already handled in this tab (FCM may deliver twice). */
  private readonly seen = new Set<string>();

  constructor() {
    this.device.forgetter = () => this.forgetToken();

    if (this.env.serviceWorker) {
      const onMessage = (e: MessageEvent) => this.onWorkerMessage(e.data);
      navigator.serviceWorker.addEventListener('message', onMessage);
      inject(DestroyRef).onDestroy(() => navigator.serviceWorker.removeEventListener('message', onMessage));
    }

    // Sign-in (or a restored session): resume this user's registration without ever prompting.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => {
        this.flag.set(id != null && readFlag(id));
        if (id != null) void this.resume(id);
      });
    });

    // A tab opened from a system notification carries `n=<id>`: drop it from the URL and mark that row read.
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      if (!this.auth.isAuthenticated()) return;
      const { url, id } = takeOpenMarker(e.urlAfterRedirects);
      if (id == null) return;
      void this.router.navigateByUrl(url, { replaceUrl: true });
      void this.center.markOpened(id);
    });
  }

  /** Loads the push config once (Profile calls it to draw the switch). A failure allows a later retry. */
  loadConfig(): Promise<PushConfig | null> {
    this.configLoad ??= this.api.pushConfig().then(
      (c) => {
        this.config.set(c);
        this.configState.set(c.enabled && c.vapid_key && c.web_config ? 'enabled' : 'disabled');
        return c;
      },
      (err) => {
        this.log.warn('Could not load the push config', err);
        this.configState.set('disabled');
        this.configLoad = null;
        return null;
      },
    );
    return this.configLoad;
  }

  /** The permission may have changed in the browser's site settings since the page loaded. */
  recheck() {
    this.permission.set(currentPermission());
  }

  // ── The switch ──
  /** Turning it on, on click only: permission → token → register → toast `4700`. */
  async enable(): Promise<void> {
    const user = this.auth.user();
    if (!user || this.busy() || typeof Notification === 'undefined') return;
    this.busy.set(true);
    try {
      // First, while the click still counts as a user gesture (Firefox and Safari need one).
      const p = await Notification.requestPermission();
      this.permission.set(p);
      const next = afterPermission(p);
      if (next !== 'subscribe') {
        if (next === 'dismissed') this.toast.show('Browser notifications are still off', { tone: 'info', body: 'Choose Allow when the browser asks.' });
        return;
      }
      const token = await this.getToken();
      if (!token) return;
      const res = await this.api.registerToken(this.registration(token));
      await this.remember(user.id, token);
      writeFlag(user.id, true);
      this.flag.set(true);
      this.toast.show(res.message || 'Notifications are on for this device.');
    } catch (err) {
      this.toast.error("Couldn't turn on browser notifications", failureText(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Turning it off: `deleteToken()` + unregister → toast `4701`. */
  async disable(): Promise<void> {
    const user = this.auth.user();
    if (!user || this.busy()) return;
    this.busy.set(true);
    try {
      const token = this.device.token ?? (this.permission() === 'granted' ? await this.getToken() : null);
      let message = 'Notifications are off for this device.';
      if (token) message = (await this.api.unregisterToken(token)) || message;
      await this.forgetToken();
      writeFlag(user.id, false);
      this.flag.set(false);
      this.toast.show(message);
    } catch (err) {
      this.toast.error("Couldn't turn off browser notifications", failureText(err));
    } finally {
      this.busy.set(false);
    }
  }

  async sendTest(): Promise<void> {
    try {
      const res = await this.api.testPush('web');
      this.toast.show(res.message || 'Test notification sent.', { body: 'It should appear on this browser in a few seconds.' });
    } catch (err) {
      this.toast.error("Couldn't send a test notification", failureText(err));
    }
  }

  // ── Internals ──
  /** App start / sign-in: never prompts. */
  private async resume(userId: number): Promise<void> {
    this.recheck();
    if (this.permission() !== 'granted' || !readFlag(userId)) return;
    const cfg = await this.loadConfig();
    if (!cfg || this.state() !== 'on') return;
    try {
      const token = await this.getToken();
      if (!token || this.auth.user()?.id !== userId) return;
      if (await this.needsRegister(userId, token)) {
        await this.api.registerToken(this.registration(token));
        await this.remember(userId, token);
      }
    } catch (err) {
      this.log.warn('Could not resume browser notifications', err);
    }
  }

  private async loadSdk(): Promise<Messaging | null> {
    if (this.messaging) return this.messaging;
    const cfg = this.config() ?? (await this.loadConfig());
    const web = cfg?.web_config;
    if (!cfg?.enabled || !web) return null;
    this.sdk ??= { app: await import('firebase/app'), messaging: await import('firebase/messaging') };
    const supported = await this.sdk.messaging.isSupported().catch(() => false);
    this.sdkSupported.set(supported);
    if (!supported) return null;
    const { initializeApp, getApps } = this.sdk.app;
    const app: FirebaseApp =
      getApps().find((a) => a.name === FIREBASE_APP_NAME) ??
      initializeApp(
        {
          apiKey: web.api_key ?? undefined,
          authDomain: web.auth_domain ?? undefined,
          projectId: web.project_id ?? undefined,
          storageBucket: web.storage_bucket ?? undefined,
          messagingSenderId: web.messaging_sender_id ?? undefined,
          appId: web.app_id ?? undefined,
        },
        FIREBASE_APP_NAME,
      );
    this.messaging = this.sdk.messaging.getMessaging(app);
    return this.messaging;
  }

  /** Registers the worker on its narrow scope and asks FCM for this browser's token. */
  private async getToken(): Promise<string | null> {
    const messaging = await this.loadSdk();
    const vapidKey = this.config()?.vapid_key;
    if (!messaging || !this.sdk || !vapidKey) return null;
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' });
    const token = await this.sdk.messaging.getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    this.device.token = token || null;
    return this.device.token;
  }

  /** `deleteToken()` (sign-out and the switch). The per-user flag stays, so the next sign-in resumes. */
  private async forgetToken(): Promise<void> {
    this.device.token = null;
    clearReg();
    if (this.messaging && this.sdk) await this.sdk.messaging.deleteToken(this.messaging);
  }

  private registration(token: string): PushTokenBody {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return {
      token,
      platform: 'web',
      app_id: location.host,
      locale: (navigator.language || 'en').slice(0, 16),
      label: deviceLabel(nav.userAgent, nav.userAgentData?.platform || undefined),
    };
  }

  private async needsRegister(userId: number, token: string): Promise<boolean> {
    const reg = readReg();
    return !reg || reg.u !== userId || reg.h !== (await sha256(token)) || Date.now() - reg.at > REREGISTER_MS;
  }

  private async remember(userId: number, token: string) {
    try {
      localStorage.setItem(REG_KEY, JSON.stringify({ u: userId, h: await sha256(token), at: Date.now() }));
    } catch {
      /* storage blocked: it registers again next time */
    }
  }

  private onWorkerMessage(msg: unknown) {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { type?: unknown; payload?: Partial<PushPayload>; link?: unknown; notification_id?: unknown };
    if (m.type === 'hn-push' && m.payload) this.foreground(m.payload);
    else if (m.type === 'hn-push-open') this.open(m.link, m.notification_id);
  }

  /** A push while a portal tab is open: refresh the bell; the focused tab also shows a toast. */
  private foreground(p: Partial<PushPayload>) {
    if (!this.auth.isAuthenticated()) return;
    const id = String(p.notification_id ?? '');
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value as string);
    }
    this.center.pushed();
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    this.toast.show(String(p.title || 'New notification'), {
      tone: 'info',
      body: p.body ? String(p.body) : undefined,
      action: { label: 'Open', run: () => this.open(p.link, id) },
    });
  }

  /** Routes in place (query parameters survive) and marks the row read. */
  private open(link: unknown, id: unknown) {
    void this.router.navigateByUrl(routeOf(link));
    const n = Number(id);
    if (this.auth.isAuthenticated() && Number.isInteger(n) && n > 0) void this.center.markOpened(n);
  }
}

function readFlag(userId: number): boolean {
  try {
    return localStorage.getItem(flagKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeFlag(userId: number, on: boolean) {
  try {
    if (on) localStorage.setItem(flagKey(userId), '1');
    else localStorage.removeItem(flagKey(userId));
  } catch {
    /* storage blocked */
  }
}

function readReg(): { u: number; h: string; at: number } | null {
  try {
    const r = JSON.parse(localStorage.getItem(REG_KEY) || 'null');
    return r && typeof r.u === 'number' && typeof r.h === 'string' && typeof r.at === 'number' ? r : null;
  } catch {
    return null;
  }
}

function clearReg() {
  try {
    localStorage.removeItem(REG_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The token is compared by hash, so it is never stored in plain text. */
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** API failures carry the server's message; Firebase and browser failures get a plain one. */
function failureText(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  return "This browser couldn't set up notifications. Try again, or check the browser's site settings.";
}
