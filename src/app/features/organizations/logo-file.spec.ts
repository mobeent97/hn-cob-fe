import { LOGO_MESSAGES, LOGO_RULES, checkLogoDimensions, checkLogoFile, isAnimatedPng, sniffLogoType } from './logo-file';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG signature followed by chunks (lengths only matter for walking them). */
function png(...chunks: [string, number][]): Uint8Array<ArrayBuffer> {
  const out: number[] = [...PNG];
  for (const [type, len] of chunks) {
    out.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)));
    out.push(...new Array(len + 4).fill(0));
  }
  return new Uint8Array(out);
}

const size = (width: number, height: number) => async () => ({ width, height });

describe('logo file checks (BRANDING_MEDIA_EMAIL.md 2.2)', () => {
  it('detects PNG and JPEG from magic bytes only', () => {
    expect(sniffLogoType(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffLogoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffLogoType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffLogoType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffLogoType(new TextEncoder().encode('RIFF....WEBP'))).toBeNull();
  });

  it('spots an animated PNG', () => {
    expect(isAnimatedPng(png(['IHDR', 13], ['acTL', 8], ['IDAT', 4]))).toBe(true);
    expect(isAnimatedPng(png(['IHDR', 13], ['IDAT', 4], ['IEND', 0]))).toBe(false);
  });

  it('checks the pixel range and the 4:1 ratio', () => {
    expect(checkLogoDimensions(64, 64)).toBeNull();
    expect(checkLogoDimensions(2048, 512)).toBeNull();
    expect(checkLogoDimensions(32, 32)).toBe(LOGO_MESSAGES.dimensions);
    expect(checkLogoDimensions(3000, 1000)).toBe(LOGO_MESSAGES.dimensions);
    expect(checkLogoDimensions(500, 99)).toBe(LOGO_MESSAGES.dimensions); // 5:1
  });

  it('refuses SVG, oversize and undecodable files with the server messages', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' });
    expect(await checkLogoFile(svg, size(100, 100))).toEqual({ ok: false, message: LOGO_MESSAGES.type });

    const big = new Blob([new Uint8Array(PNG), new Uint8Array(LOGO_RULES.maxBytes)], { type: 'image/png' });
    expect(await checkLogoFile(big, size(100, 100))).toEqual({ ok: false, message: LOGO_MESSAGES.size });

    const corrupt = new Blob([png(['IHDR', 13])], { type: 'image/png' });
    expect(await checkLogoFile(corrupt, async () => null)).toEqual({ ok: false, message: LOGO_MESSAGES.unreadable });
  });

  it('accepts a PNG in range and reports its size', async () => {
    const ok = new Blob([png(['IHDR', 13], ['IDAT', 4])], { type: 'image/png' });
    expect(await checkLogoFile(ok, size(320, 96))).toEqual({ ok: true, type: 'image/png', width: 320, height: 96 });
    expect(await checkLogoFile(ok, size(32, 32))).toEqual({ ok: false, message: LOGO_MESSAGES.dimensions });
  });
});
