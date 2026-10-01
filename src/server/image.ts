import sharp from "sharp";

// On Windows sharp's file cache keeps images open, which blocks deleting the
// temp files afterwards.
sharp.cache(false);

/** A file that is not a usable image; the message is fit to show the user. */
export class ImageError extends Error {}

/** Guards memory: a decoded image takes 4 bytes per pixel or more. */
export const MAX_PIXELS = 100_000_000;

export const openImage = (path: string) => sharp(path, { limitInputPixels: MAX_PIXELS, failOn: "error" });

export type ImageInfo = {
  /** Size as displayed, i.e. after applying the photo's rotation tag. */
  width: number;
  height: number;
  hasAlpha: boolean;
  /** sharp's name for the source format, e.g. "jpeg". */
  format: string;
};

export async function inspectImage(path: string): Promise<ImageInfo> {
  try {
    const { width, height, orientation, hasAlpha, format } = await openImage(path).metadata();
    if (!width || !height || !format) throw new ImageError("This file has no readable picture in it");
    const sideways = (orientation ?? 1) >= 5;
    return {
      width: sideways ? height : width,
      height: sideways ? width : height,
      hasAlpha: Boolean(hasAlpha),
      format,
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    if (/pixel limit/i.test(error instanceof Error ? error.message : "")) {
      throw new ImageError(`This image is too large (the limit is ${MAX_PIXELS / 1_000_000} megapixels)`);
    }
    throw new ImageError("This file could not be read as an image");
  }
}
