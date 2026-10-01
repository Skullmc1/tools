// Plain numbers and arithmetic, no imports, so the browser can use them too.

/** Guards memory: a decoded image takes 4 bytes per pixel or more. */
export const MAX_PIXELS = 100_000_000;

/** A vector image can be drawn at any size; this is as large as we allow. */
export const MAX_VECTOR_WIDTH = 8192;

/**
 * The widest output offered for a source. Photos are never enlarged, but a
 * vector image has no native resolution, so it can be drawn bigger.
 */
export function maxWidthFor(info: { width: number; height: number; vector: boolean }): number {
  if (!info.vector) return info.width;
  const fitsInMemory = Math.floor(Math.sqrt((MAX_PIXELS * info.width) / info.height));
  return Math.max(1, Math.min(MAX_VECTOR_WIDTH, fitsInMemory));
}
