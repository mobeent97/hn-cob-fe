import { FALLBACK_ROUTE, routeOf, takeOpenMarker, withOpenMarker } from './link';

describe('notification links (PUSH_NOTIFICATIONS.md 1.6)', () => {
  it('keeps portal routes as router URLs, query parameters included', () => {
    expect(routeOf('/audit?request=42')).toBe('/audit?request=42');
    expect(routeOf('/customers/123')).toBe('/customers/123');
    expect(routeOf('/notifications#top')).toBe('/notifications#top');
  });

  it('sends anything that breaks the route rule to /notifications', () => {
    for (const bad of [
      '', 'audit', 'https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)',
      '/a b', '/a\nb', `/${'x'.repeat(300)}`, null, undefined, 42, {},
    ]) {
      expect(routeOf(bad)).toBe(FALLBACK_ROUTE);
    }
    expect(routeOf(`/${'x'.repeat(299)}`)).toHaveLength(300);
  });

  it('appends n=<id> with ? or & as needed, before any fragment', () => {
    expect(withOpenMarker('/audit', 981)).toBe('/audit?n=981');
    expect(withOpenMarker('/audit?request=42', '981')).toBe('/audit?request=42&n=981');
    expect(withOpenMarker('/audit?request=42#row', 7)).toBe('/audit?request=42&n=7#row');
    expect(withOpenMarker('/audit', '')).toBe('/audit');
    expect(withOpenMarker('https://evil.example', 5)).toBe('/notifications?n=5');
  });

  it('takes n back out and returns the id', () => {
    expect(takeOpenMarker('/audit?request=42&n=981')).toEqual({ url: '/audit?request=42', id: 981 });
    expect(takeOpenMarker('/audit?n=981')).toEqual({ url: '/audit', id: 981 });
    expect(takeOpenMarker('/audit?n=7&request=42#row')).toEqual({ url: '/audit?request=42#row', id: 7 });
    expect(takeOpenMarker('/audit?request=42')).toEqual({ url: '/audit?request=42', id: null });
    expect(takeOpenMarker('/audit')).toEqual({ url: '/audit', id: null });
  });

  it('drops a malformed n without trusting it', () => {
    expect(takeOpenMarker('/audit?n=abc')).toEqual({ url: '/audit', id: null });
    expect(takeOpenMarker('/audit?n=0')).toEqual({ url: '/audit', id: null });
    expect(takeOpenMarker('/audit?n=')).toEqual({ url: '/audit', id: null });
  });

  it('round-trips', () => {
    const link = '/customers/12?tab=devices';
    expect(takeOpenMarker(withOpenMarker(link, 55))).toEqual({ url: link, id: 55 });
  });
});
