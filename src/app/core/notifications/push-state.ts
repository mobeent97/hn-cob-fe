/**
 * The "Browser notifications" switch (PUSH_NOTIFICATIONS.md 6.4 and 6.5) as a pure function of what the
 * browser offers, the server's push config, the permission and the user's choice on this browser.
 */

export type PushState =
  /** The push config hasn't answered yet. */
  | 'loading'
  /** Config `enabled: false`: the row is hidden. */
  | 'unavailable'
  /** Not a secure context, or no service worker / PushManager / Notification, or Firebase says no. */
  | 'unsupported'
  /** iPhone or iPad in a Safari tab: it only works from a Home Screen web app. */
  | 'ios-tab'
  /** `Notification.permission === 'denied'`. */
  | 'blocked'
  | 'off'
  | 'on';

export type PermissionState = NotificationPermission | 'unknown';

export interface PushEnv {
  /** HTTPS or http://localhost. */
  secure: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  ios: boolean;
  /** Opened from the Home Screen (`navigator.standalone` or `display-mode: standalone`). */
  standalone: boolean;
}

export interface PushFacts {
  config: 'loading' | 'enabled' | 'disabled';
  env: PushEnv;
  /** Firebase's `isSupported()`; null until the SDK has loaded (assumed fine until then). */
  sdkSupported: boolean | null;
  permission: PermissionState;
  /** `localStorage['hn.push.on.<userId>']`: this user turned it on in this browser. */
  flag: boolean;
}

export function pushState(f: PushFacts): PushState {
  if (f.config === 'loading') return 'loading';
  if (f.config === 'disabled') return 'unavailable';
  if (!f.env.secure) return 'unsupported';
  // Before the API checks: Safari in an iOS tab has no PushManager, and the useful answer is the Home Screen.
  if (f.env.ios && !f.env.standalone) return 'ios-tab';
  if (!f.env.serviceWorker || !f.env.pushManager || !f.env.notification || f.sdkSupported === false) return 'unsupported';
  if (f.permission === 'denied') return 'blocked';
  return f.flag && f.permission === 'granted' ? 'on' : 'off';
}

/** What turning the switch on does after `Notification.requestPermission()` answers. */
export function afterPermission(p: PermissionState): 'subscribe' | 'blocked' | 'dismissed' {
  if (p === 'granted') return 'subscribe';
  return p === 'denied' ? 'blocked' : 'dismissed';
}

/** One line of plain guidance per state (the switch row's description). */
export const PUSH_STATE_TEXT: Record<PushState, string> = {
  loading: '',
  unavailable: '',
  unsupported: "This browser can't show portal notifications. Use a current browser over HTTPS (or http://localhost).",
  'ios-tab': 'On iPhone and iPad, add the portal to your Home Screen, open it from there, then turn this on.',
  blocked: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload.",
  off: 'Get a system notification on this browser for the kinds you mark under Browser, even when the portal is in the background.',
  on: 'This browser shows a system notification for the kinds you mark under Browser.',
};

interface NavLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  serviceWorker?: unknown;
}

interface WinLike {
  isSecureContext?: boolean;
  navigator: NavLike;
  PushManager?: unknown;
  Notification?: unknown;
  matchMedia?: (q: string) => { matches: boolean };
}

export function isIos(nav: NavLike): boolean {
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

export function detectEnv(win: WinLike = window as unknown as WinLike): PushEnv {
  const nav = win.navigator;
  return {
    secure: !!win.isSecureContext,
    serviceWorker: 'serviceWorker' in nav && !!nav.serviceWorker,
    pushManager: 'PushManager' in win,
    notification: 'Notification' in win,
    ios: isIos(nav),
    standalone: nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches,
  };
}

export function currentPermission(): PermissionState {
  return typeof Notification === 'undefined' ? 'unknown' : Notification.permission;
}

/** "Chrome on Windows", for the device list (≤ 60 characters, no version numbers). */
export function deviceLabel(ua: string, uaPlatform?: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = uaPlatform || (/Windows/.test(ua) ? 'Windows'
    : /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : '');
  return (os ? `${browser} on ${os}` : browser).slice(0, 60);
}
