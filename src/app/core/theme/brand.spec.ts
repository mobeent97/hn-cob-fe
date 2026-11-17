import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.models';
import { BRAND_KEY, BrandTheme, brandColourFor } from './brand';
import { brandScale } from './brand-scale';
import { Theme } from './theme';

const user = (over: Partial<AuthUser> = {}, org: Partial<NonNullable<AuthUser['organization']>> | null = {}): AuthUser => ({
  id: 7, email: 'a@vodafone.qa', full_name: 'Aisha Khan', phone: '', is_superuser: false, status: 'Active', last_login: null,
  organization: org === null ? null : { id: 3, name: 'Vodafone Qatar', kind: 'Partner', status: 'Active', brand_colour: '#e60000', logo_url: null, ...org },
  ...over,
});

const prop = (step: number) => document.documentElement.style.getPropertyValue(`--color-brand-${step}`);
const stored = () => JSON.parse(localStorage.getItem(BRAND_KEY) ?? 'null');

describe('BrandTheme (BRANDING_MEDIA_EMAIL.md 1.4)', () => {
  let me: ReturnType<typeof signal<AuthUser | null>>;
  let version: ReturnType<typeof signal<number>>;

  function setup() {
    me = signal<AuthUser | null>(null);
    // jsdom has no matchMedia; BrandTheme only bumps Theme.version.
    version = signal(0);
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { user: me } }, { provide: Theme, useValue: { version } }],
    });
    const brand = TestBed.inject(BrandTheme);
    TestBed.tick();
    return brand;
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('decides the brand from the signed-in user only', () => {
    expect(brandColourFor(user())).toBe('#e60000');
    expect(brandColourFor(user({}, { brand_colour: '#E60000' }))).toBe('#e60000');
    expect(brandColourFor(user({}, { brand_colour: null }))).toBeNull();
    expect(brandColourFor(user({}, { kind: 'Platform', brand_colour: '#4c1d95' }))).toBeNull();
    expect(brandColourFor(user({ is_superuser: true }))).toBeNull();
    expect(brandColourFor(user({}, null))).toBeNull();
    expect(brandColourFor(null)).toBeNull();
  });

  it('applies a partner brand, remembers it, and keeps it for the login page after sign-out', () => {
    setup();
    expect(prop(600)).toBe('');
    me.set(user());
    TestBed.tick();
    const scale = brandScale('#e60000');
    expect(prop(600)).toBe(scale[600]);
    expect(prop(950)).toBe(scale[950]);
    expect(version()).toBeGreaterThan(0); // charts and maps re-read the tokens
    expect(stored()).toEqual({ colour: '#e60000', scale });

    me.set(null);
    TestBed.tick();
    expect(prop(600)).toBe(scale[600]);
    expect(stored()?.colour).toBe('#e60000');
  });

  it('resets to the built-in purple and forgets the brand for a default-brand user', () => {
    localStorage.setItem(BRAND_KEY, JSON.stringify({ colour: '#e60000', scale: brandScale('#e60000') }));
    setup();
    expect(prop(600)).toBe(brandScale('#e60000')[600]); // signed out: the last brand on this browser
    me.set(user({}, { kind: 'Platform' }));
    TestBed.tick();
    expect(prop(600)).toBe('');
    expect(localStorage.getItem(BRAND_KEY)).toBeNull();
  });

  it('lets a page show another brand until it lets go', () => {
    const brand = setup();
    me.set(null);
    const release = brand.usePageBrand('#00a3ad');
    TestBed.tick();
    expect(prop(500)).toBe(brandScale('#00a3ad')[500]);
    release();
    TestBed.tick();
    expect(prop(500)).toBe('');
  });
});
