import { describe, expect, test } from "bun:test";
import {
  buildGifArgs,
  encodeUnderTarget,
  estimateSample,
  type GifSettings,
  nextAttempt,
  normalizeSettings,
  outputHeight,
  parseProbe,
  parseProgressSeconds,
  type VideoInfo,
} from "../src/tools/gif/ffmpeg.ts";

const info: VideoInfo = { duration: 10, width: 1920, height: 1080, fps: 30 };
const base: GifSettings = { start: 2, end: 6, fps: 15, width: 480, quality: "medium" };

describe("parseProbe", () => {
  test("reads size, duration and frame rate", () => {
    const probe = {
      streams: [{ width: 1280, height: 720, avg_frame_rate: "30000/1001" }],
      format: { duration: "12.5" },
    };
    expect(parseProbe(probe)).toEqual({ duration: 12.5, width: 1280, height: 720, fps: 30000 / 1001 });
  });

  test("swaps width and height for sideways phone video", () => {
    const probe = {
      streams: [{ width: 1920, height: 1080, avg_frame_rate: "30/1", side_data_list: [{ rotation: -90 }] }],
      format: { duration: "3" },
    };
    expect(parseProbe(probe)).toMatchObject({ width: 1080, height: 1920 });
  });

  test("falls back to r_frame_rate when the average is unknown", () => {
    const probe = {
      streams: [{ width: 10, height: 10, avg_frame_rate: "0/0", r_frame_rate: "25/1", duration: "4" }],
      format: {},
    };
    expect(parseProbe(probe)).toMatchObject({ fps: 25, duration: 4 });
  });

  test("rejects a file with no video track", () => {
    expect(() => parseProbe({ streams: [], format: { duration: "3" } })).toThrow(/no video/i);
  });
});

describe("normalizeSettings", () => {
  test("keeps valid settings", () => {
    expect(normalizeSettings(base, info)).toEqual(base);
  });

  test("clamps to what the source can provide", () => {
    const s = normalizeSettings({ start: -5, end: 99, fps: 120, width: 4000, quality: "high" }, info);
    expect(s).toEqual({ start: 0, end: 10, fps: 30, width: 1920, quality: "high" });
  });

  test("fills in defaults for missing or junk values", () => {
    const s = normalizeSettings({ fps: "abc", quality: "ultra" }, info);
    expect(s).toEqual({ start: 0, end: 10, fps: 15, width: 480, quality: "medium" });
  });

  test("rejects an empty selection", () => {
    expect(() => normalizeSettings({ ...base, start: 5, end: 5 }, info)).toThrow(/too short/i);
  });
});

describe("buildGifArgs", () => {
  const args = buildGifArgs("in.mp4", "out.gif", base);
  const filter = args[args.indexOf("-filter_complex") + 1]!;

  test("seeks before the input and limits the duration", () => {
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("2.000");
    expect(args[args.indexOf("-t") + 1]).toBe("4.000");
    expect(args[args.indexOf("-i") + 1]).toBe("in.mp4");
    expect(args.at(-1)).toBe("out.gif");
  });

  test("applies fps and width, then builds and uses a palette", () => {
    expect(filter).toContain("fps=15");
    expect(filter).toContain("scale=480:-1:flags=lanczos");
    expect(filter.indexOf("palettegen")).toBeLessThan(filter.indexOf("paletteuse"));
  });

  test("reports machine-readable progress on stdout", () => {
    expect(args[args.indexOf("-progress") + 1]).toBe("pipe:1");
  });

  test("quality changes the palette size", () => {
    const colors = (quality: GifSettings["quality"]) =>
      /max_colors=(\d+)/.exec(buildGifArgs("a", "b", { ...base, quality }).join(" "))![1];
    expect(Number(colors("low"))).toBeLessThan(Number(colors("medium")));
    expect(Number(colors("medium"))).toBeLessThan(Number(colors("high")));
  });
});

describe("parseProgressSeconds", () => {
  test("returns the latest timestamp in a chunk", () => {
    const chunk = "frame=10\nout_time_us=1500000\nprogress=continue\nframe=20\nout_time_us=2250000\nprogress=continue\n";
    expect(parseProgressSeconds(chunk)).toBe(2.25);
  });

  test("returns null when the chunk has no timestamp", () => {
    expect(parseProgressSeconds("frame=10\nfps=0.0\n")).toBeNull();
    expect(parseProgressSeconds("out_time_us=N/A\n")).toBeNull();
  });
});

describe("estimateSample", () => {
  test("takes one second from the middle of the selection", () => {
    expect(estimateSample(base)).toEqual({ start: 3.5, end: 4.5 });
  });

  test("uses the whole selection when it is shorter than a second", () => {
    expect(estimateSample({ ...base, start: 1, end: 1.4 })).toEqual({ start: 1, end: 1.4 });
  });
});

test("outputHeight follows the aspect ratio", () => {
  expect(outputHeight(480, info)).toBe(270);
});

describe("nextAttempt", () => {
  const limits = { minWidth: 160, minFps: 5 };

  test("shrinks width first", () => {
    const next = nextAttempt(base, 4_000_000, 2_000_000, limits)!;
    expect(next.width).toBeLessThan(480);
    expect(next.width).toBeGreaterThanOrEqual(160);
    expect(next.fps).toBe(15);
  });

  test("lowers fps once width hits its floor", () => {
    const next = nextAttempt({ ...base, width: 200 }, 10_000_000, 1_000_000, limits)!;
    expect(next.width).toBe(160);
    expect(next.fps).toBeLessThan(15);
    expect(next.fps).toBeGreaterThanOrEqual(5);
  });

  test("gives up when nothing can go lower", () => {
    expect(nextAttempt({ ...base, width: 160, fps: 5 }, 10_000_000, 1_000_000, limits)).toBeNull();
  });
});

describe("encodeUnderTarget", () => {
  // A fake encoder whose output size is proportional to pixels per second.
  const fake = (bytesPerUnit: number) => {
    const calls: GifSettings[] = [];
    const discarded: number[] = [];
    return {
      calls,
      discarded,
      encode: async (s: GifSettings) => {
        calls.push(s);
        return { bytes: Math.round(s.width * s.width * s.fps * bytesPerUnit) };
      },
      discard: (out: { bytes: number }) => void discarded.push(out.bytes),
    };
  };

  test("stops after one attempt when already under the target", async () => {
    const f = fake(0.1);
    const r = await encodeUnderTarget(base, 10_000_000, f.encode, f.discard);
    expect(r.attempts).toBe(1);
    expect(r.hit).toBe(true);
    expect(r.settings).toEqual(base);
    expect(f.discarded).toEqual([]);
  });

  test("retries with smaller settings until under the target", async () => {
    const f = fake(1);
    const first = 480 * 480 * 15;
    const r = await encodeUnderTarget(base, first / 3, f.encode, f.discard);
    expect(r.hit).toBe(true);
    expect(r.output.bytes).toBeLessThanOrEqual(first / 3);
    expect(r.attempts).toBeGreaterThan(1);
    expect(r.settings.width).toBeLessThan(480);
    expect(f.discarded).toContain(first);
  });

  test("returns the smallest result when the target is out of reach", async () => {
    const f = fake(1000);
    const r = await encodeUnderTarget(base, 10, f.encode, f.discard);
    expect(r.hit).toBe(false);
    expect(r.attempts).toBeLessThanOrEqual(4);
    expect(r.output.bytes).toBe(Math.min(...f.calls.map((s) => s.width * s.width * s.fps * 1000)));
  });
});
