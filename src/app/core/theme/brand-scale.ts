/**
 * An organization's brand colour → the eleven `--color-brand-*` steps (BRANDING_MEDIA_EMAIL.md §1.4).
 * Pure functions, no Angular: unit-tested against the shared vectors in `brand_vectors.json`, which the
 * backend's email `accent` is tested against too.
 *
 * 1. The input becomes OKLCH. Each step takes a fixed lightness (Tailwind purple's ladder) and a share of the
 *    input chroma, clamped to the sRGB gamut at that lightness and the input hue.
 * 2. The step whose ladder lightness is nearest the input's takes the input exactly (ties: the lighter step).
 * 3. Steps that fail a contrast constraint move 0.5 L at a time (darker against light colours, lighter against
 *    dark ones) until they pass; then every step is kept at least 1.5 L darker than the one before, pushing
 *    neighbours further in the direction the repaired step moved.
 * One scale serves both themes.
 */

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type BrandStep = (typeof BRAND_STEPS)[number];
export type BrandScale = Record<BrandStep, string>;

/** Lightness (OKLCH %, Tailwind purple) and the share of the input chroma, per step. */
const LADDER_L = [97.7, 94.6, 90.2, 82.7, 71.4, 62.7, 55.8, 49.6, 43.8, 38.1, 29.1];
const CHROMA_RATIO = [0.05, 0.11, 0.22, 0.41, 0.7, 0.92, 1.0, 0.92, 0.76, 0.61, 0.52];

/** Below this chroma the input counts as neutral (grey): same formula, hue irrelevant. */
export const NEUTRAL_C = 0.015;
const L_STEP = 0.5;
const MIN_GAP = 1.5;

/** The surfaces the constraints are measured against (theme.css). */
export const SURFACES = { white: '#ffffff', canvas: '#f8f7fa', darkSurface: '#17131f', darkCanvas: '#09090f' } as const;

interface Constraint {
  against: string;
  ratio: number;
  /** -1: darken to pass (against a light colour); +1: lighten (against a dark colour). */
  dir: -1 | 1;
}
/** Step index → constraint. 600/700 carry white button text and links; 300/400 are dark-mode accents. */
const CONSTRAINTS: Partial<Record<number, Constraint>> = {
  3: { against: SURFACES.darkSurface, ratio: 4.5, dir: 1 },
  4: { against: SURFACES.darkSurface, ratio: 3, dir: 1 },
  5: { against: SURFACES.white, ratio: 3, dir: -1 },
  6: { against: SURFACES.canvas, ratio: 4.5, dir: -1 },
  7: { against: SURFACES.canvas, ratio: 4.5, dir: -1 },
};

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ── Colour maths ──────────────────────────────────────────────

export interface Oklch {
  /** 0–100 (%). */
  l: number;
  c: number;
  /** Degrees, 0–360. */
  h: number;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  if (!HEX_RE.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Linear sRGB (unclipped) for an OKLCH colour. */
function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const L = l / 100;
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L * 100, c, h: h < 0 ? h + 360 : h };
}

const EPS = 1e-6;
function inGamut(l: number, c: number, h: number) {
  return oklchToLinear(l, c, h).every((v) => v >= -EPS && v <= 1 + EPS);
}

/** The largest chroma still inside sRGB at this lightness and hue (binary search, 0.001 precision). */
export function maxChroma(l: number, h: number): number {
  if (l <= 0 || l >= 100) return 0;
  let lo = 0;
  let hi = 0.4; // sRGB's largest OKLCH chroma is about 0.32
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (inGamut(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** `#rrggbb`, clipped to sRGB. */
export function oklchToHex(l: number, c: number, h: number): string {
  return (
    '#' +
    oklchToLinear(l, c, h)
      .map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** WCAG 2.x relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── The scale ─────────────────────────────────────────────────

interface Step {
  l: number;
  /** The chroma this step aims for before the gamut clamp (input chroma × the step's ratio). */
  target: number;
  hex: string;
}

/** Normalises user input (`#ABC123` → `#abc123`); null when it isn't `#rrggbb`. */
export function normalizeHex(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return HEX_RE.test(t) ? t.toLowerCase() : null;
}

export function brandScale(input: string): BrandScale {
  const hex = normalizeHex(input);
  if (!hex) throw new Error(`Not a #rrggbb colour: ${input}`);
  const src = hexToOklch(hex);
  // A near-grey input (chroma under NEUTRAL_C) runs the same formula; its hue barely shows.
  const h = src.h;
  const paint = (l: number, target: number) => oklchToHex(l, Math.min(target, maxChroma(l, h)), h);

  const steps: Step[] = LADDER_L.map((l, i) => {
    const target = src.c * CHROMA_RATIO[i];
    return { l, target, hex: paint(l, target) };
  });

  // Anchor: the organization sees its own colour exactly, at the step nearest its lightness.
  let anchor = 0;
  for (let i = 1; i < LADDER_L.length; i++) {
    if (Math.abs(LADDER_L[i] - src.l) < Math.abs(LADDER_L[anchor] - src.l)) anchor = i;
  }
  steps[anchor] = { l: src.l, target: steps[anchor].target, hex };

  // Contrast repair.
  const move = (i: number, l: number) => {
    const s = steps[i];
    s.l = Math.min(100, Math.max(0, l));
    s.hex = paint(s.l, s.target);
  };
  for (const [key, con] of Object.entries(CONSTRAINTS)) {
    const i = Number(key);
    const k = con!;
    while (contrast(steps[i].hex, k.against) < k.ratio && steps[i].l > 0 && steps[i].l < 100) {
      move(i, steps[i].l + k.dir * L_STEP);
    }
  }

  // Ordering, at least MIN_GAP darker per step: only 300/400 are ever lightened, so the steps above 500 are
  // pushed up from there; only 500–700 are ever darkened, so the steps from 500 down are pushed down.
  const split = BRAND_STEPS.indexOf(500);
  for (let i = split - 1; i >= 0; i--) {
    if (steps[i].l < steps[i + 1].l + MIN_GAP) move(i, steps[i + 1].l + MIN_GAP);
  }
  for (let i = split; i < steps.length; i++) {
    if (steps[i].l > steps[i - 1].l - MIN_GAP) move(i, steps[i - 1].l - MIN_GAP);
  }

  return Object.fromEntries(BRAND_STEPS.map((s, i) => [s, steps[i].hex])) as BrandScale;
}

/** True when step 600 (primary buttons) isn't the exact input: the UI says "Adjusted for readability". */
export function isAdjusted(input: string, scale: BrandScale = brandScale(input)): boolean {
  return scale[600] !== normalizeHex(input);
}
