import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.models';
import { BRAND_STEPS, BrandScale, brandScale, normalizeHex } from './brand-scale';
import { Theme } from './theme';

/** `localStorage` key: the last brand used on this browser, `{ colour, scale }` only (no name, no logo). */
export const BRAND_KEY = 'hn-brand';

interface StoredBrand {
  colour: string;
  scale: BrandScale;
}

/**
 * The colour that brands the portal for this user (BRANDING_MEDIA_EMAIL.md 1.2): a partner user's own
 * organization colour; null (the built-in HyperNym purple) for platform users, superusers and partners
 * without a colour. The viewed scope never changes it.
 */
export function brandColourFor(user: AuthUser | null): string | null {
  const org = user?.organization;
  if (!user || user.is_superuser || !org || org.kind === 'Platform') return null;
  return normalizeHex(org.brand_colour);
}

/** Whether the signed-in user gets the organization brand (logo and name in the sidebar) at all. */
export function usesOrgBrand(user: AuthUser | null): boolean {
  return !!user && !user.is_superuser && !!user.organization && user.organization.kind !== 'Platform';
}

function readStored(): StoredBrand | null {
  try {
    const raw = JSON.parse(localStorage.getItem(BRAND_KEY) ?? 'null') as Partial<StoredBrand> | null;
    const colour = normalizeHex(raw?.colour);
    return colour ? { colour, scale: brandScale(colour) } : null;
  } catch {
    return null;
  }
}

/**
 * Applies the brand scale as inline `--color-brand-*` properties on <html>, which override the `@theme`
 * purple. Signed in: the user's own brand (saved for the next visit, cleared for default-brand users).
 * Signed out: the last brand on this browser, as index.html's pre-paint script does, so the login page
 * never flashes another colour and never shows a name or logo. A page can override it while it is open
 * (set-password shows the inviting organization's brand).
 */
@Injectable({ providedIn: 'root' })
export class BrandTheme {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(Theme);
  private readonly stored = signal<StoredBrand | null>(readStored());
  /** undefined: no page override; null: the default brand; a hex: that brand. */
  private readonly pageBrand = signal<string | null | undefined>(undefined);
  private appliedColour: string | null | undefined = undefined;

  /** The colour in force now, or null for the built-in purple. */
  readonly colour = computed<string | null>(() => {
    const page = this.pageBrand();
    if (page !== undefined) return page;
    const user = this.auth.user();
    return user ? brandColourFor(user) : (this.stored()?.colour ?? null);
  });

  constructor() {
    // Remember the signed-in user's brand for the login page; a default-brand sign-in forgets it.
    effect(() => {
      const user = this.auth.user();
      if (!user) return; // sign-out keeps the last brand (contract 1.4)
      const colour = brandColourFor(user);
      untracked(() => this.remember(colour));
    });
    effect(() => {
      const colour = this.colour();
      untracked(() => this.apply(colour));
    });
  }

  /** Shows `colour` (null = default) until the returned function is called. */
  usePageBrand(colour: string | null): () => void {
    this.pageBrand.set(normalizeHex(colour));
    return () => this.pageBrand.set(undefined);
  }

  private remember(colour: string | null) {
    if (colour === (this.stored()?.colour ?? null)) return;
    const next = colour ? { colour, scale: brandScale(colour) } : null;
    this.stored.set(next);
    try {
      if (next) localStorage.setItem(BRAND_KEY, JSON.stringify(next));
      else localStorage.removeItem(BRAND_KEY);
    } catch {
      /* storage blocked: the brand still applies for this visit */
    }
  }

  private apply(colour: string | null) {
    if (colour === this.appliedColour) return;
    this.appliedColour = colour;
    const style = document.documentElement.style;
    const scale = colour ? brandScale(colour) : null;
    for (const step of BRAND_STEPS) {
      if (scale) style.setProperty(`--color-brand-${step}`, scale[step]);
      else style.removeProperty(`--color-brand-${step}`);
    }
    // ECharts and MapLibre resolve token colours once; tell them to re-read.
    this.theme.version.update((v) => v + 1);
  }
}
