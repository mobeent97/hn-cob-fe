import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BRAND_STEPS, SURFACES, brandScale, contrast, isAdjusted, normalizeHex } from '../../core/theme/brand-scale';
import { Icon } from '../../shared/ui/icon';

/**
 * "What will this colour look like in the portal?" The derived scale as a strip (BRANDING_MEDIA_EMAIL.md 1.4),
 * a primary button and a link drawn with it, and "Adjusted for readability" when buttons can't use the exact
 * colour. All colours here are data bound from the scale, so they stay the same in both themes.
 */
@Component({
  selector: 'app-brand-preview',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview(); as p) {
      <div class="strip" role="img" [attr.aria-label]="'Brand scale derived from ' + p.colour">
        @for (s of p.steps; track s.step) {
          <span class="cell" [class.anchor]="s.hex === p.colour" [style.background]="s.hex" [title]="s.step + ' ' + s.hex"></span>
        }
      </div>
      <div class="samples">
        <span class="sample-btn" [style.background]="p.scale[600]">Primary button</span>
        <span class="sample-link" [style.color]="p.scale[700]">A link</span>
        <span class="sample-dark"><span [style.color]="p.scale[300]">Dark-mode accent</span></span>
      </div>
      @if (p.adjusted) {
        <p class="note" role="status">
          <app-icon name="info" [size]="14" />
          <span>
            <strong>Adjusted for readability.</strong>
            @if (p.lowContrast) {
              White text on {{ p.colour }} only reaches {{ p.raw }}:1 (4.5:1 is needed), so buttons and links use {{ p.scale[600] }}.
            } @else {
              Buttons use {{ p.scale[600] }}, the shade at the portal's button lightness, so every screen keeps the same rhythm.
            }
            @if (p.anchored) { {{ p.colour }} itself is in the scale, marked above. }
          </span>
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .strip {
      display: grid;
      grid-template-columns: repeat(11, 1fr);
      height: 1.5rem;
      overflow: hidden;
      border-radius: 0.5rem;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 10%, transparent);
    }
    .cell.anchor {
      box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--color-white) 80%, transparent);
    }
    .samples {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      font-size: 12px;
    }
    .sample-btn {
      display: inline-flex;
      align-items: center;
      height: var(--control-height-sm);
      padding: 0 0.75rem;
      border-radius: 0.75rem;
      color: var(--color-white);
      font-weight: 600;
    }
    .sample-link {
      padding: 0.25rem 0.5rem;
      border-radius: 0.5rem;
      background: var(--color-canvas);
      font-weight: 600;
      text-decoration: underline;
    }
    .sample-dark {
      padding: 0.25rem 0.5rem;
      border-radius: 0.5rem;
      background: var(--color-dark-surface);
      font-weight: 600;
    }
    .note {
      display: flex;
      gap: 0.5rem;
      margin: 0;
      font-size: 12px;
      line-height: 1.4;
      color: var(--color-muted);
    }
    .note app-icon {
      flex: none;
      margin-top: 1px;
      color: var(--color-info);
    }
  `,
})
export class BrandPreview {
  /** `#rrggbb` (anything else draws nothing). */
  readonly colour = input<string | null | undefined>(null);

  protected readonly preview = computed(() => {
    const colour = normalizeHex(this.colour());
    if (!colour) return null;
    const scale = brandScale(colour);
    return {
      colour,
      scale,
      steps: BRAND_STEPS.map((step) => ({ step, hex: scale[step] })),
      adjusted: isAdjusted(colour, scale),
      anchored: Object.values(scale).includes(colour),
      raw: contrast(colour, SURFACES.white).toFixed(1),
      lowContrast: contrast(colour, SURFACES.white) < 4.5,
    };
  });
}
