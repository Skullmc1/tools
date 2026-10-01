import sharp, { type OutputInfo } from "sharp";

// On Windows sharp's file cache keeps images open, which blocks deleting the
// temp files afterwards.
sharp.cache(false);

// Pure image work for the background remover: no model, no server. The model
// sits behind `Segmenter` so this can be tested with a stand-in.

export type Rgb = { data: Uint8Array; width: number; height: number };
export type Mask = { data: Uint8Array; width: number; height: number };

export interface Segmenter {
  /** A foreground mask for the image: 255 is subject, 0 is background. */
  segment(image: Rgb): Promise<Mask>;
}

export class ImageError extends Error {}

/** The model works at 1024px, so more than this only costs memory. */
export const MODEL_INPUT_MAX = 2048;
const MAX_PIXELS = 100_000_000;

const open = (path: string) => sharp(path, { limitInputPixels: MAX_PIXELS, failOn: "error" });

/** Size as displayed, i.e. after applying the photo's rotation tag. */
export async function probeImage(path: string): Promise<{ width: number; height: number }> {
  try {
    const { width, height, orientation } = await open(path).metadata();
    if (!width || !height) throw new ImageError("This file has no readable picture in it");
    return (orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) {
      throw new ImageError(`This image is too large (the limit is ${MAX_PIXELS / 1_000_000} megapixels)`);
    }
    throw new ImageError("This file could not be read as an image");
  }
}

/** Multiplies the picture's own transparency by the mask, in place. */
export function applyMask(rgba: Uint8Array, mask: Uint8Array): void {
  for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
    rgba[a] = Math.round((rgba[a]! * mask[i]!) / 255);
  }
}

/**
 * Removes the background from `input` and writes a transparent PNG to
 * `output`, at the picture's full resolution.
 */
export async function cutOut(
  input: string,
  output: string,
  segmenter: Segmenter,
  hooks: { beforeSegment?: () => void; signal?: AbortSignal } = {},
): Promise<{ width: number; height: number; bytes: number }> {
  let full: { data: Buffer; info: OutputInfo };
  try {
    full = await open(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageError("This file could not be read as an image");
  }
  const { width, height } = full.info;
  hooks.signal?.throwIfAborted();

  // The model only sees an opaque, downscaled copy.
  const small = await sharp(full.data, { raw: { width, height, channels: 4 } })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .resize(MODEL_INPUT_MAX, MODEL_INPUT_MAX, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  hooks.beforeSegment?.();
  const mask = await segmenter.segment({ data: small.data, width: small.info.width, height: small.info.height });
  hooks.signal?.throwIfAborted();

  const fullMask =
    mask.width === width && mask.height === height
      ? mask.data
      : await sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } })
          .resize(width, height, { fit: "fill", kernel: "lanczos3" })
          .extractChannel(0) // sharp would otherwise hand back three identical channels
          .raw()
          .toBuffer();

  applyMask(full.data, fullMask);
  const written = await sharp(full.data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toFile(output);
  return { width, height, bytes: written.size };
}
