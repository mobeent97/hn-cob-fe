import { BRAND_STEPS, NEUTRAL_C, SURFACES, brandScale, contrast, hexToOklch, isAdjusted, normalizeHex } from './brand-scale';
import fixture from './brand_vectors.json';

/** Tailwind purple, the built-in default the HyperNym vector is sanity-checked against. */
const TAILWIND_PURPLE: Record<number, string> = {
  50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7',
  600: '#9333ea', 700: '#7e22ce', 800: '#6b21a8', 900: '#581c87', 950: '#3b0764',
};

/** Euclidean OKLab distance (0–1 lightness scale). */
function deltaE(a: string, b: string) {
  const [p, q] = [hexToOklch(a), hexToOklch(b)];
  const ab = (o: { c: number; h: number }) => [o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
  const [pa, pb] = ab(p);
  const [qa, qb] = ab(q);
  return Math.hypot((p.l - q.l) / 100, pa - qa, pb - qb);
}

const hueDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

describe('brandScale (BRANDING_MEDIA_EMAIL.md 1.4)', () => {
  for (const v of fixture.vectors) {
    describe(`${v.name} ${v.input}`, () => {
      const scale = brandScale(v.input);

      it('matches the shared vector file', () => {
        expect(scale).toEqual(v.scale as unknown as typeof scale);
        expect(isAdjusted(v.input, scale)).toBe(v.adjusted);
      });

      it('is strictly darker from 50 to 950', () => {
        const ls = BRAND_STEPS.map((s) => hexToOklch(scale[s]).l);
        for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]);
      });

      it('meets the light-mode constraints', () => {
        for (const s of [600, 700] as const) {
          expect(contrast(scale[s], SURFACES.white)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(scale[s], SURFACES.canvas)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(scale[500], SURFACES.white)).toBeGreaterThanOrEqual(3);
      });

      it('meets the dark-mode constraints', () => {
        for (const bg of [SURFACES.darkSurface, SURFACES.darkCanvas]) {
          expect(contrast(scale[300], bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(scale[400], bg)).toBeGreaterThanOrEqual(3);
        }
      });

      it('keeps the input hue on every chromatic step', () => {
        const src = hexToOklch(v.input);
        if (src.c < NEUTRAL_C) return;
        for (const s of BRAND_STEPS) {
          const o = hexToOklch(scale[s]);
          if (o.c < NEUTRAL_C) continue;
          // ±1°, plus what 8-bit hex rounding (about 0.002 in a/b) can swing at this chroma.
          const rounding = (Math.atan(0.002 / o.c) * 180) / Math.PI;
          expect(hueDiff(o.h, src.h)).toBeLessThanOrEqual(1 + rounding);
        }
      });

      it('shows the input itself at one step', () => {
        expect(Object.values(scale)).toContain(normalizeHex(v.input)!);
      });
    });
  }

  it('covers the vectors the contract names', () => {
    const inputs = fixture.vectors.map((v) => v.input);
    for (const hex of ['#ffff00', '#ffffff', '#000000', '#808080', '#e60000', '#ffcb05', '#00a3ad', '#9333ea']) expect(inputs).toContain(hex);
  });

  it('stays close to Tailwind purple for the HyperNym purple', () => {
    const scale = brandScale('#9333ea');
    for (const s of BRAND_STEPS) expect(deltaE(scale[s], TAILWIND_PURPLE[s])).toBeLessThan(0.04);
  });

  it('accepts upper-case input and rejects anything but #rrggbb', () => {
    expect(brandScale('#E60000')).toEqual(brandScale('#e60000'));
    expect(normalizeHex(' #ABCDEF ')).toBe('#abcdef');
    expect(normalizeHex('#abc')).toBeNull();
    expect(() => brandScale('red')).toThrow();
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });
});
