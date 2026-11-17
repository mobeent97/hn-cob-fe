/**
 * Client-side checks for an organization logo, mirroring the server's `org_logo` rules
 * (BRANDING_MEDIA_EMAIL.md 2.2): PNG or JPEG by magic bytes, at most 512 KB, a single frame, 64–2048 px on
 * each side and at most four times wider than tall. The messages are the server's (codes 4602–4605), so the
 * user reads the same sentence whichever side refuses the file. The server still checks everything.
 */

export const LOGO_RULES = { maxBytes: 512 * 1024, minPx: 64, maxPx: 2048, maxAspect: 4 } as const;
export const LOGO_ACCEPT = 'image/png,image/jpeg';
export const LOGO_HINT = 'PNG or JPEG. A square or wide PNG with a transparent background works best.';

export const LOGO_MESSAGES = {
  type: 'Upload a PNG or JPEG image.',
  size: 'The file is too large. The limit is 512 KB.',
  dimensions: 'The image must be 64 to 2048 pixels on each side and at most four times wider than it is tall.',
  unreadable: "We couldn't read this image. Try another file.",
} as const;

export type LogoType = 'image/png' | 'image/jpeg';
export type LogoCheck = { ok: true; type: LogoType; width: number; height: number } | { ok: false; message: string };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The real type from the first bytes, ignoring the file name and the browser's guess. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  if (PNG_SIG.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** An APNG declares `acTL` before its first `IDAT`. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + len;
  }
  return false;
}

export function checkLogoDimensions(width: number, height: number): string | null {
  const { minPx, maxPx, maxAspect } = LOGO_RULES;
  const inRange = (n: number) => n >= minPx && n <= maxPx;
  return inRange(width) && inRange(height) && width <= height * maxAspect ? null : LOGO_MESSAGES.dimensions;
}

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** Decodes the image to read its pixel size; null when the browser can't. */
async function decodeSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size;
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Runs the checks in the server's order: type, size, frames, decode, dimensions. */
export async function checkLogoFile(file: Blob, decode: (f: Blob) => Promise<{ width: number; height: number } | null> = decodeSize): Promise<LogoCheck> {
  const head = await readBytes(file.slice(0, 64 * 1024));
  const type = sniffLogoType(head);
  if (!type) return { ok: false, message: LOGO_MESSAGES.type };
  if (file.size > LOGO_RULES.maxBytes) return { ok: false, message: LOGO_MESSAGES.size };
  if (type === 'image/png' && isAnimatedPng(head)) return { ok: false, message: LOGO_MESSAGES.unreadable };
  const size = await decode(file);
  if (!size || !size.width || !size.height) return { ok: false, message: LOGO_MESSAGES.unreadable };
  const dims = checkLogoDimensions(size.width, size.height);
  if (dims) return { ok: false, message: dims };
  return { ok: true, type, ...size };
}
