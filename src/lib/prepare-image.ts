import { UPLOAD_IMAGE_TYPES } from './compose-media';

/**
 * Gets a picked image ready to upload, in the browser:
 * - PNG and GIF within the size limit go as they are (a GIF may be animated; re-drawing would freeze it).
 * - Everything else — JPEG, HEIC from an iPhone, WebP, AVIF, or a PNG over the limit — is drawn again and saved as
 *   JPEG. That also drops the photo's metadata (EXIF: where and when it was taken, the camera), which Atlas never
 *   sends; the picture keeps its orientation.
 * - At most Mastodon's 8.3 megapixels (3840 × 2160 worth), stepping quality and then size down until it fits.
 */
export const MAX_PIXELS = 3840 * 2160;

export class ImageTooLarge extends Error {}
export class ImageUnreadable extends Error {}

/** Width and height scaled down to at most `maxPixels`, keeping the shape. */
export function fitPixels(w: number, h: number, maxPixels = MAX_PIXELS): { w: number; h: number } {
  if (w * h <= maxPixels) return { w, h };
  const k = Math.sqrt(maxPixels / (w * h));
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)) };
}

async function decode(file: Blob): Promise<{ draw: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { draw: b, w: b.width, h: b.height, close: () => b.close() };
    } catch { /* some formats (HEIC in some browsers) decode only through <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { draw: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageUnreadable();
  }
}

function toJpeg(src: CanvasImageSource, w: number, h: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#fff'; // JPEG has no transparency: transparent areas become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

const jpegName = (name: string) => `${(name.replace(/\.[^.]+$/, '') || 'image').slice(0, 80)}.jpg`;

export async function prepareImage(file: File, maxBytes: number): Promise<File> {
  const keep = file.type === 'image/gif' || file.type === 'image/png';
  if (keep && (UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.type) && file.size <= maxBytes) return file;
  if (file.type === 'image/gif') throw new ImageTooLarge(); // an animation can't be re-drawn without losing it
  const img = await decode(file);
  try {
    let { w, h } = fitPixels(img.w, img.h);
    for (let round = 0; round < 4; round++) {
      for (const q of [0.9, 0.82, 0.72]) {
        const blob = await toJpeg(img.draw, w, h, q);
        if (!blob) throw new ImageUnreadable();
        if (blob.size <= maxBytes) return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
      }
      w = Math.max(1, Math.floor(w * 0.75)); h = Math.max(1, Math.floor(h * 0.75));
    }
    throw new ImageTooLarge();
  } finally {
    img.close();
  }
}
