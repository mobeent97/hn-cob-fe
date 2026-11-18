/**
 * Notification links (PUSH_NOTIFICATIONS.md 1.6): a platform-neutral portal route such as
 * `/audit?request=42`, opened with `router.navigateByUrl`. Keep `routeOf` and `withOpenMarker` in step
 * with the copies in `public/firebase-messaging-sw.js`.
 */

/** Where a link that breaks the route rule goes instead. */
export const FALLBACK_ROUTE = '/notifications';
const MAX_LINK = 300;

/**
 * The link as a router URL: it must start with `/` (not `//`), have no scheme, and be at most 300
 * characters. Backslashes and control or space characters are refused too, because browsers read
 * `/\host` as `//host`. Anything else becomes `/notifications`.
 */
export function routeOf(link: unknown): string {
  if (typeof link !== 'string' || !link || link.length > MAX_LINK) return FALLBACK_ROUTE;
  if (link[0] !== '/' || link[1] === '/' || /[\\\s\u0000-\u001f\u007f]/.test(link)) return FALLBACK_ROUTE;
  return link;
}

/** `link` plus `n=<id>`, so a tab opened from a system notification can mark that row read. */
export function withOpenMarker(link: string, id: string | number | null | undefined): string {
  const route = routeOf(link);
  if (id === null || id === undefined || id === '') return route;
  const hash = route.indexOf('#');
  const path = hash < 0 ? route : route.slice(0, hash);
  const frag = hash < 0 ? '' : route.slice(hash);
  return `${path}${path.includes('?') ? '&' : '?'}n=${encodeURIComponent(String(id))}${frag}`;
}

/**
 * The reverse, for the root component after sign-in: the URL without `n`, and the notification id it
 * carried (null when there was none or it isn't a positive integer).
 */
export function takeOpenMarker(url: string): { url: string; id: number | null } {
  const hash = url.indexOf('#');
  const frag = hash < 0 ? '' : url.slice(hash);
  const beforeHash = hash < 0 ? url : url.slice(0, hash);
  const q = beforeHash.indexOf('?');
  if (q < 0) return { url, id: null };
  const path = beforeHash.slice(0, q);
  const parts = beforeHash.slice(q + 1).split('&').filter(Boolean);
  let raw: string | null = null;
  const kept = parts.filter((p) => {
    const [k, v = ''] = p.split('=');
    if (k !== 'n') return true;
    raw = decodeURIComponent(v);
    return false;
  });
  if (raw === null) return { url, id: null };
  const id = /^[1-9]\d{0,17}$/.test(raw) ? Number(raw) : null;
  return { url: `${path}${kept.length ? `?${kept.join('&')}` : ''}${frag}`, id };
}
