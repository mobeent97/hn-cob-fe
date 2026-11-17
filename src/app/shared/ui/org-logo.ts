import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';

/** First letter of the first two words, upper-case ("Vodafone Qatar" → "VQ"). */
export function orgInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * An organization's logo (a SAS URL) on a white tile, `object-fit: contain`, the same in both themes so dark
 * logos stay visible. Without a logo, or when it fails to load, it falls back to `initials` (the given colour, else a brand-700
 * tile, for the signed-in user's own organization) or `swatch` (the organization's colour, as lists show it).
 * Decorative: the name is always written next to it.
 */
@Component({
  selector: 'app-org-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--logo-size.px]': 'size()', 'aria-hidden': 'true' },
  template: `
    @if (url() && !broken()) {
      <span class="tile logo"><img [src]="url()" alt="" decoding="async" (error)="fail()" /></span>
    } @else if (fallback() === 'initials') {
      <span class="tile initials" [style.background]="colour() || null" [style.color]="initialsInk()">{{ initials() }}</span>
    } @else {
      <span class="sw" [style.background]="colour() || null"></span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: var(--logo-size);
      height: var(--logo-size);
    }
    .tile {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: calc(var(--logo-size) * 0.25);
    }
    .logo {
      background: var(--color-white); /* a white tile in both themes (contract 1.5), so dark logos stay visible */
      padding: calc(var(--logo-size) * 0.09);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 10%, transparent);
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .initials {
      background: var(--color-brand-700);
      color: var(--color-white);
      font-weight: 700;
      font-size: max(10px, calc(var(--logo-size) * 0.38));
      letter-spacing: 0.02em;
    }
    .sw {
      width: max(10px, calc(var(--logo-size) * 0.5));
      height: max(10px, calc(var(--logo-size) * 0.5));
      border-radius: 3px;
      background: var(--color-brand-400);
    }
  `,
})
export class OrgLogo {
  readonly url = input<string | null | undefined>(null);
  readonly name = input('');
  /** The organization's brand colour (data), for the swatch fallback. */
  readonly colour = input<string | null | undefined>('');
  readonly size = input(32);
  readonly fallback = input<'initials' | 'swatch'>('swatch');
  /** The image failed to load (an expired SAS URL, say). */
  readonly failed = output<void>();

  /** Resets whenever a new URL arrives. */
  protected readonly broken = linkedSignal({ source: this.url, computation: () => false });
  protected readonly initials = computed(() => orgInitials(this.name()));
  /** White initials on a dark colour, ink on a light one (≥ 4.5:1 either way); null keeps the stylesheet's. */
  protected readonly initialsInk = computed(() => {
    const hex = /^#?([0-9a-f]{6})$/i.exec(this.colour() ?? '')?.[1];
    if (!hex) return null;
    const lin = (i: number) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    return 1.05 / (l + 0.05) >= 4.5 ? 'var(--color-white)' : '#111111';
  });

  protected fail() {
    this.broken.set(true);
    this.failed.emit();
  }
}
