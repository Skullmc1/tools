import { type ImageInfo, openImage } from "../../server/image.ts";
import { maxWidthFor } from "../../server/limits.ts";

// Pure conversion logic for the image converter: no server, no model.

export type Format = "png" | "jpeg" | "webp" | "avif";
export type Background = "white" | "black";

export type ConvertSettings = {
  format: Format;
  /** 1 to 100. PNG is lossless and ignores it. */
  quality: number;
  /** Output width in pixels; height follows. Photos are never enlarged; vector images may be. */
  width: number;
  /** What transparent areas become when the format cannot hold transparency. */
  background: Background;
};

export const FORMATS: Record<Format, { ext: string; label: string; lossless: boolean; transparency: boolean }> = {
  png: { ext: "png", label: "PNG image", lossless: true, transparency: true },
  jpeg: { ext: "jpg", label: "JPEG image", lossless: false, transparency: false },
  webp: { ext: "webp", label: "WebP image", lossless: false, transparency: true },
  avif: { ext: "avif", label: "AVIF image", lossless: false, transparency: true },
};

export const DEFAULTS = { format: "webp" as Format, quality: 80, background: "white" as Background };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Validates settings from the client against what the source can provide. */
export function normalizeSettings(raw: any, info: ImageInfo): ConvertSettings {
  return {
    format: typeof raw?.format === "string" && raw.format in FORMATS ? raw.format : DEFAULTS.format,
    quality: clamp(Math.round(numberOr(raw?.quality, DEFAULTS.quality)), 1, 100),
    width: clamp(Math.round(numberOr(raw?.width, info.width)), 1, maxWidthFor(info)),
    background: raw?.background === "black" ? "black" : DEFAULTS.background,
  };
}

/** The name to suggest when saving: the source's, with the new extension. */
export function outputName(sourceName: string, format: Format): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  const ext = FORMATS[format].ext;
  const same = dot > 0 && sourceName.slice(dot + 1).toLowerCase().replace("jpeg", "jpg") === ext;
  return same ? `${base} (converted).${ext}` : `${base}.${ext}`;
}

/**
 * Converts `input` to `output`. The result is oriented upright and carries no
 * metadata, so camera details and GPS location are dropped.
 */
export async function convertImage(
  input: string,
  output: string,
  settings: ConvertSettings,
  info: ImageInfo,
  signal?: AbortSignal,
): Promise<{ width: number; height: number; bytes: number }> {
  signal?.throwIfAborted();
  // A vector image is drawn at the target size instead of being scaled up afterwards.
  let image = openImage(input, info.vector ? { density: (72 * settings.width) / info.width } : {}).rotate();
  if (info.vector) {
    // The density rounds to whole pixels, so land on the exact width asked for.
    if ((await image.metadata()).width !== settings.width) image = image.resize({ width: settings.width });
  } else if (settings.width < info.width) {
    image = image.resize({ width: settings.width, kernel: "lanczos3" });
  }
  if (!FORMATS[settings.format].transparency) {
    image = image.flatten({ background: settings.background === "black" ? "#000000" : "#ffffff" });
  }

  switch (settings.format) {
    case "png":
      image = image.png({ compressionLevel: 9, effort: 7 });
      break;
    case "jpeg":
      image = image.jpeg({ quality: settings.quality, mozjpeg: true });
      break;
    case "webp":
      image = image.webp({ quality: settings.quality, effort: 4 });
      break;
    case "avif":
      image = image.avif({ quality: settings.quality, effort: 4 });
      break;
  }

  const written = await image.toFile(output);
  return { width: written.width, height: written.height, bytes: written.size };
}
