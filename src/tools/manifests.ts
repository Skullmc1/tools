// Plain data only: this file is imported by the CLI before `bun install` has
// run, so it must not pull in any package.

export type ToolManifest = {
  id: string;
  name: string;
  tagline: string;
  /** Short "from → to" label shown on the home page. */
  from: string;
  to: string;
  /** File extensions the drop zone accepts, without the dot. */
  accepts: string[];
  /** Programs that must be on PATH for this tool to work. */
  requires: string[];
  status: "live" | "planned";
};

export const manifests: ToolManifest[] = [
  {
    id: "gif",
    name: "Video to GIF",
    tagline: "Trim a clip, pick a size, get a GIF.",
    from: "MP4",
    to: "GIF",
    accepts: ["mp4", "mov", "webm", "mkv", "m4v", "avi"],
    requires: ["ffmpeg", "ffprobe"],
    status: "live",
  },
  {
    id: "bg-remove",
    name: "Remove background",
    tagline: "Cut the subject out as a transparent PNG.",
    from: "IMG",
    to: "PNG",
    accepts: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff"],
    requires: [],
    status: "live",
  },
  {
    id: "pdf-to-images",
    name: "PDF to images",
    tagline: "Every page as a PNG or JPEG.",
    from: "PDF",
    to: "PNG",
    accepts: ["pdf"],
    requires: [],
    status: "planned",
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    tagline: "Stack pictures into one document.",
    from: "JPG",
    to: "PDF",
    accepts: ["png", "jpg", "jpeg", "webp"],
    requires: [],
    status: "planned",
  },
  {
    id: "image-convert",
    name: "Image converter",
    tagline: "PNG, JPEG, WebP and AVIF, with quality and size.",
    from: "PNG",
    to: "WEBP",
    accepts: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff"],
    requires: [],
    status: "live",
  },
  {
    id: "compress",
    name: "File compressor",
    tagline: "Make big files smaller.",
    from: "ANY",
    to: "ZIP",
    accepts: [],
    requires: [],
    status: "planned",
  },
];

export const liveManifests = manifests.filter((m) => m.status === "live");
