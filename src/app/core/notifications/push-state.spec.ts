import { PushEnv, PushFacts, afterPermission, detectEnv, deviceLabel, isIos, pushState } from './push-state';

const DESKTOP: PushEnv = { secure: true, serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: false };
const facts = (over: Partial<PushFacts> = {}, env: Partial<PushEnv> = {}): PushFacts => ({
  config: 'enabled',
  env: { ...DESKTOP, ...env },
  sdkSupported: true,
  permission: 'default',
  flag: false,
  ...over,
});

describe('pushState (PUSH_NOTIFICATIONS.md 6.4)', () => {
  it('waits for the config, and hides the row when push is not configured', () => {
    expect(pushState(facts({ config: 'loading' }))).toBe('loading');
    expect(pushState(facts({ config: 'disabled', permission: 'granted', flag: true }))).toBe('unavailable');
  });

  it('is unsupported outside a secure context or without the browser APIs', () => {
    expect(pushState(facts({}, { secure: false }))).toBe('unsupported');
    expect(pushState(facts({}, { serviceWorker: false }))).toBe('unsupported');
    expect(pushState(facts({}, { pushManager: false }))).toBe('unsupported');
    expect(pushState(facts({}, { notification: false }))).toBe('unsupported');
    expect(pushState(facts({ sdkSupported: false }))).toBe('unsupported');
    // Not known yet: assumed fine, so the switch doesn't flicker.
    expect(pushState(facts({ sdkSupported: null }))).toBe('off');
  });

  it('asks iPhone and iPad users in a tab to add the portal to the Home Screen', () => {
    // Safari tabs have no PushManager, but the useful answer is the Home Screen one.
    expect(pushState(facts({}, { ios: true, standalone: false, pushManager: false }))).toBe('ios-tab');
    expect(pushState(facts({ permission: 'granted', flag: true }, { ios: true, standalone: true }))).toBe('on');
    // Without HTTPS nothing helps.
    expect(pushState(facts({}, { ios: true, secure: false }))).toBe('unsupported');
  });

  it('is blocked when the permission is denied, whatever the flag says', () => {
    expect(pushState(facts({ permission: 'denied', flag: true }))).toBe('blocked');
  });

  it('is on only with permission granted and this user’s flag set', () => {
    expect(pushState(facts({ permission: 'granted', flag: true }))).toBe('on');
    expect(pushState(facts({ permission: 'granted', flag: false }))).toBe('off');
    expect(pushState(facts({ permission: 'default', flag: true }))).toBe('off');
    expect(pushState(facts({ permission: 'unknown', flag: true }))).toBe('off');
  });

  it('maps the permission answer to the next step', () => {
    expect(afterPermission('granted')).toBe('subscribe');
    expect(afterPermission('denied')).toBe('blocked');
    expect(afterPermission('default')).toBe('dismissed');
  });
});

describe('push environment', () => {
  it('detects iPadOS posing as a Mac by its touch points', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  });

  it('reads the browser APIs and the standalone display mode', () => {
    const env = detectEnv({
      isSecureContext: true,
      navigator: { userAgent: 'x', serviceWorker: {}, standalone: undefined },
      PushManager: function PushManager() {},
      Notification: function Notification() {},
      matchMedia: () => ({ matches: true }),
    });
    expect(env).toEqual({ secure: true, serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: true });
    expect(detectEnv({ isSecureContext: false, navigator: { userAgent: 'x' } })).toMatchObject({
      secure: false, serviceWorker: false, pushManager: false, notification: false,
    });
  });

  it('labels the device without versions', () => {
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
    expect(deviceLabel(chromeWin)).toBe('Chrome on Windows');
    expect(deviceLabel(`${chromeWin} Edg/131.0`)).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox on Linux');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iPhone');
    expect(deviceLabel(chromeWin, 'macOS')).toBe('Chrome on macOS');
  });
});
