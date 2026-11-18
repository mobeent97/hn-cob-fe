/*
 * HN COB portal push worker (hn-cob-be/docs/PUSH_NOTIFICATIONS.md 6.2).
 *
 * Plain JS: no Firebase SDK and no CDN scripts. Served at the root path but registered by PushService with
 * the narrow scope /firebase-cloud-messaging-push-scope, so it never controls page loads. Hosting must serve it
 * as application/javascript with Cache-Control: no-cache and no SPA fallback.
 *
 * Pushes are FCM data-only messages (5.2). This worker builds every system notification itself:
 * - push: hand the payload to every portal window ({type: 'hn-push'}); show a notification unless a window is
 *   focused (always on WebKit, which requires one per push);
 * - notificationclick: focus an existing window and let it route in place ({type: 'hn-push-open'}), or open
 *   the link with n=<id> so the new tab can mark the row read.
 *
 * routeOf and withOpenMarker mirror src/app/core/notifications/link.ts; keep them in step.
 */
'use strict';

const ICON = '/assets/push/icon-192.png';
const BADGE = '/assets/push/badge-72.png';
const FALLBACK_ROUTE = '/notifications';

function routeOf(link) {
  if (typeof link !== 'string' || !link || link.length > 300) return FALLBACK_ROUTE;
  if (link[0] !== '/' || link[1] === '/' || /[\\\s\u0000-\u001f\u007f]/.test(link)) return FALLBACK_ROUTE;
  return link;
}

function withOpenMarker(link, id) {
  const route = routeOf(link);
  if (id === null || id === undefined || id === '') return route;
  const hash = route.indexOf('#');
  const path = hash < 0 ? route : route.slice(0, hash);
  const frag = hash < 0 ? '' : route.slice(hash);
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'n=' + encodeURIComponent(String(id)) + frag;
}

/** Safari (macOS, iPadOS) and every iOS browser show a notification for every push or lose the subscription. */
function isWebKit() {
  const ua = self.navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /AppleWebKit/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua);
}

async function portalWindows() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((c) => {
    try {
      return new URL(c.url).origin === self.location.origin;
    } catch (e) {
      return false;
    }
  });
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

async function onPush(event) {
  let raw = {};
  try {
    raw = event.data ? event.data.json() : {};
  } catch (e) {
    raw = {};
  }
  // FCM puts the data block under `data`; tolerate it at the top level too.
  const d = raw && typeof raw.data === 'object' && raw.data ? raw.data : raw || {};
  if (str(d.v) !== '1') return; // a schema this worker doesn't understand

  const id = str(d.notification_id);
  const payload = {
    notification_id: id,
    kind: str(d.kind),
    title: str(d.title) || 'HyperNym',
    body: str(d.body),
    link: routeOf(d.link),
    tag: str(d.tag) || (id ? 'n-' + id : 'hn-push'),
    sent_at: str(d.sent_at),
  };

  const windows = await portalWindows();
  for (const w of windows) w.postMessage({ type: 'hn-push', payload });
  if (windows.some((w) => w.focused) && !isWebKit()) return; // the focused tab shows a toast instead

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    renotify: true,
    icon: ICON,
    badge: BADGE,
    timestamp: Date.parse(payload.sent_at) || Date.now(),
    data: { link: payload.link, notification_id: id },
  });
}

async function onClick(event) {
  const data = event.notification.data || {};
  const link = routeOf(data.link);
  const id = str(data.notification_id);
  const windows = await portalWindows();
  const win =
    windows.find((w) => w.focused) || windows.find((w) => w.visibilityState === 'visible') || windows[0];
  if (win) {
    try {
      await win.focus();
    } catch (e) {
      /* focus may be refused; the window still routes */
    }
    win.postMessage({ type: 'hn-push-open', link, notification_id: id });
    return;
  }
  await self.clients.openWindow(withOpenMarker(link, id));
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event) => event.waitUntil(onPush(event)));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(onClick(event));
});

// Token rotation is handled by the portal's daily re-register.
self.addEventListener('pushsubscriptionchange', () => {});
