// Pure logic for the GIF converter: no processes, no files.

export type Quality = "low" | "medium" | "high";

export type GifSettings = {
  /** Seconds into the source. */
  start: number;
  end: number;
  fps: number;
  /** Output width in pixels; height follows the aspect ratio. */
  width: number;
  quality: Quality;
};

export type VideoInfo = { duration: number; width: number; height: number; fps: number };

export class SettingsError extends Error {}

const DEFAULTS = { fps: 15, width: 480, quality: "medium" as Quality };
const MIN_DURATION = 0.05;
// GIF frame delays are whole centiseconds, so nothing above 50 fps survives.
const MAX_FPS = 50;
const MIN_WIDTH = 16;

const PALETTES: Record<Quality, { colors: number; stats: string; dither: string }> = {
  low: { colors: 64, stats: "diff", dither: "bayer:bayer_scale=3" },
  medium: { colors: 128, stats: "diff", dither: "bayer:bayer_scale=5" },
  high: { colors: 256, stats: "full", dither: "sierra2_4a" },
};

function parseRate(rate: unknown): number {
  const [num, den] = String(rate ?? "").split("/").map(Number);
  const value = den ? num! / den : num!;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Turns `ffprobe -show_streams -show_format -of json` output into VideoInfo. */
export function parseProbe(probe: any): VideoInfo {
  const stream = probe?.streams?.[0];
  if (!stream?.width || !stream?.height) throw new SettingsError("This file has no video track");

  const duration = Number(probe.format?.duration ?? stream.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new SettingsError("Could not read the video's length");

  const rotation = Number(
    stream.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0,
  );
  const sideways = Math.abs(rotation) % 180 === 90;

  return {
    duration,
    width: sideways ? stream.height : stream.width,
    height: sideways ? stream.width : stream.height,
    fps: parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate) || 30,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Validates settings from the client against what the source can provide. */
export function normalizeSettings(raw: any, info: VideoInfo): GifSettings {
  const start = clamp(numberOr(raw?.start, 0), 0, info.duration);
  const end = clamp(numberOr(raw?.end, info.duration), 0, info.duration);
  if (end - start < MIN_DURATION) throw new SettingsError("The selected range is too short");

  const maxFps = clamp(Math.round(info.fps), 1, MAX_FPS);
  return {
    start,
    end,
    fps: clamp(Math.round(numberOr(raw?.fps, DEFAULTS.fps)), 1, maxFps),
    width: clamp(Math.round(numberOr(raw?.width, DEFAULTS.width)), Math.min(MIN_WIDTH, info.width), info.width),
    quality: raw?.quality in PALETTES ? raw.quality : DEFAULTS.quality,
  };
}

export function outputHeight(width: number, info: VideoInfo): number {
  return Math.max(1, Math.round((width * info.height) / info.width));
}

export function buildGifArgs(input: string, output: string, s: GifSettings): string[] {
  const palette = PALETTES[s.quality];
  const filter =
    `[0:v]fps=${s.fps},scale=${s.width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${palette.colors}:stats_mode=${palette.stats}[p];` +
    `[b][p]paletteuse=dither=${palette.dither}:diff_mode=rectangle[out]`;
  return [
    "-hide_banner", "-nostdin", "-v", "error", "-y",
    "-ss", s.start.toFixed(3),
    "-t", (s.end - s.start).toFixed(3),
    "-i", input,
    "-filter_complex", filter,
    "-map", "[out]",
    "-loop", "0",
    "-progress", "pipe:1", "-nostats",
    output,
  ];
}

/** Latest output timestamp in a chunk of `-progress` output, in seconds. */
export function parseProgressSeconds(chunk: string): number | null {
  // Older builds only print out_time_ms, which is also in microseconds.
  const matches = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) / 1_000_000 : null;
}

/** The slice encoded to estimate the full output size. */
export function estimateSample(s: GifSettings, seconds = 1): { start: number; end: number } {
  const duration = s.end - s.start;
  if (duration <= seconds) return { start: s.start, end: s.end };
  const start = s.start + (duration - seconds) / 2;
  return { start, end: start + seconds };
}

export type TargetLimits = { minWidth: number; minFps: number };
const TARGET_LIMITS: TargetLimits = { minWidth: 160, minFps: 5 };
const MAX_ATTEMPTS = 4;

/**
 * Smaller settings to try after an encode came out over the target, or null
 * if nothing can go lower. Size scales roughly with width² × fps, so width
 * takes the cut first and fps covers what width's floor leaves over.
 */
export function nextAttempt(
  s: GifSettings,
  bytes: number,
  targetBytes: number,
  limits: TargetLimits = TARGET_LIMITS,
): GifSettings | null {
  const shrink = (targetBytes / bytes) * 0.9;
  const minWidth = Math.min(limits.minWidth, s.width);
  const minFps = Math.min(limits.minFps, s.fps);

  const width = Math.max(minWidth, Math.floor(s.width * Math.sqrt(shrink)));
  const leftover = shrink / (width / s.width) ** 2;
  const fps = leftover < 0.95 ? Math.max(minFps, Math.floor(s.fps * leftover)) : s.fps;

  return width === s.width && fps === s.fps ? null : { ...s, width, fps };
}

/**
 * Encodes, then re-encodes with smaller settings until the output fits the
 * target. Always returns the smallest output produced; `discard` is called
 * for every other one.
 */
export async function encodeUnderTarget<T extends { bytes: number }>(
  base: GifSettings,
  targetBytes: number,
  encode: (settings: GifSettings, attempt: number) => Promise<T>,
  discard: (output: T) => void,
): Promise<{ settings: GifSettings; output: T; attempts: number; hit: boolean }> {
  let settings = base;
  let best: { settings: GifSettings; output: T } | undefined;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const output = await encode(settings, attempts);
    if (!best || output.bytes < best.output.bytes) {
      if (best) discard(best.output);
      best = { settings, output };
    } else {
      discard(output);
    }
    if (output.bytes <= targetBytes) break;
    const next = nextAttempt(settings, output.bytes, targetBytes);
    if (!next) break;
    settings = next;
  }

  return { ...best!, attempts, hit: best!.output.bytes <= targetBytes };
}
