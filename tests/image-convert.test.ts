import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { inspectImage } from "../src/server/image.ts";
import { type ConvertSettings, convertImage, normalizeSettings, outputName } from "../src/tools/image-convert/convert.ts";

const dir = mkdtempSync(join(tmpdir(), "tools-conv-"));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const base: ConvertSettings = { format: "webp", quality: 80, width: 400, background: "white" };

/** Noise compresses badly, so quality and format changes show up in the size. */
async function photo(name: string, width = 400, height = 300) {
  const path = join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: "#888888", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .png()
    .toFile(path);
  return path;
}

async function convert(input: string, out: string, settings: Partial<ConvertSettings> = {}) {
  const info = await inspectImage(input);
  const result = await convertImage(input, join(dir, out), { ...base, width: info.width, ...settings }, info);
  return { ...result, path: join(dir, out), meta: await sharp(join(dir, out)).metadata() };
}

describe("formats", () => {
  test.each([
    ["png", "png"],
    ["jpeg", "jpeg"],
    ["webp", "webp"],
    ["avif", "heif"], // sharp reports AVIF files as heif
  ] as const)("writes a real %s file", async (format, sharpName) => {
    const input = await photo(`src-${format}.png`);
    const out = await convert(input, `out.${format}`, { format });
    expect(out.meta.format).toBe(sharpName);
    expect(out.meta).toMatchObject({ width: 400, height: 300 });
    expect(out.bytes).toBe(Bun.file(out.path).size);
  });
});

describe("quality", () => {
  test("lower quality makes smaller lossy files", async () => {
    const input = await photo("q.png");
    for (const format of ["jpeg", "webp", "avif"] as const) {
      const low = await convert(input, `q-low.${format}`, { format, quality: 20 });
      const high = await convert(input, `q-high.${format}`, { format, quality: 90 });
      expect(low.bytes).toBeLessThan(high.bytes);
    }
  });

  test("PNG is lossless, so quality changes nothing", async () => {
    const input = await photo("p.png");
    const a = await convert(input, "p-a.png", { format: "png", quality: 10 });
    const b = await convert(input, "p-b.png", { format: "png", quality: 100 });
    expect(a.bytes).toBe(b.bytes);
  });
});

describe("resizing", () => {
  test("scales down and keeps the aspect ratio", async () => {
    const input = await photo("r.png", 400, 300);
    const out = await convert(input, "r-out.webp", { width: 200 });
    expect(out.meta).toMatchObject({ width: 200, height: 150 });
  });

  test("never enlarges", async () => {
    const input = await photo("big.png", 100, 50);
    const info = await inspectImage(input);
    expect(normalizeSettings({ width: 5000 }, info).width).toBe(100);
    const out = await convert(input, "big-out.webp", { width: 100 });
    expect(out.meta.width).toBe(100);
  });
});

describe("transparency", () => {
  async function seeThrough() {
    const path = join(dir, "clear.png");
    const raw = Buffer.alloc(20 * 20 * 4);
    for (let i = 0; i < 400; i++) raw.set([255, 0, 0, i % 20 < 10 ? 255 : 0], i * 4); // left half red, right half clear
    await sharp(raw, { raw: { width: 20, height: 20, channels: 4 } }).png().toFile(path);
    return path;
  }
  const pixel = async (path: string, x: number, y: number) => {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const o = (y * info.width + x) * info.channels;
    return [...data.slice(o, o + 4)];
  };

  test("is kept in PNG, WebP and AVIF", async () => {
    const input = await seeThrough();
    for (const format of ["png", "webp"] as const) {
      const out = await convert(input, `clear-out.${format}`, { format, quality: 100 });
      expect((await pixel(out.path, 15, 10))[3]).toBe(0);
      expect((await pixel(out.path, 5, 10))[3]).toBe(255);
    }
    expect((await convert(input, "clear.avif", { format: "avif" })).meta.hasAlpha).toBe(true);
  });

  test("is filled with the chosen colour for JPEG", async () => {
    const input = await seeThrough();
    const white = await convert(input, "clear-w.jpg", { format: "jpeg", quality: 100, background: "white" });
    const black = await convert(input, "clear-b.jpg", { format: "jpeg", quality: 100, background: "black" });
    expect(white.meta.hasAlpha).toBe(false);
    const [wr, wg, wb] = await pixel(white.path, 15, 10);
    const [br, bg, bb] = await pixel(black.path, 15, 10);
    expect(Math.min(wr!, wg!, wb!)).toBeGreaterThan(240);
    expect(Math.max(br!, bg!, bb!)).toBeLessThan(15);
  });
});

describe("metadata and orientation", () => {
  test("stands a rotated photo upright and drops EXIF such as GPS", async () => {
    const input = join(dir, "phone.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "#336699" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "private" } } })
      .toFile(input);
    expect(await inspectImage(input)).toMatchObject({ width: 100, height: 200 });
    for (const format of ["jpeg", "webp", "png"] as const) {
      const out = await convert(input, `phone.${format}`, { format });
      expect(out.meta).toMatchObject({ width: 100, height: 200 });
      expect(out.meta.exif).toBeUndefined();
      expect(out.meta.orientation).toBeUndefined();
    }
  });
});

describe("cancelling", () => {
  test("does not start when already cancelled", async () => {
    const input = await photo("c.png");
    const info = await inspectImage(input);
    const controller = new AbortController();
    controller.abort();
    await expect(convertImage(input, join(dir, "c-out.webp"), base, info, controller.signal)).rejects.toThrow();
    expect(await Bun.file(join(dir, "c-out.webp")).exists()).toBe(false);
  });
});

describe("normalizeSettings", () => {
  const info = { width: 800, height: 600, hasAlpha: false, format: "png" };
  test("keeps valid settings", () => {
    expect(normalizeSettings({ format: "avif", quality: 55, width: 640, background: "black" }, info)).toEqual({
      format: "avif",
      quality: 55,
      width: 640,
      background: "black",
    });
  });
  test("clamps and fills in defaults", () => {
    expect(normalizeSettings({ format: "bmp", quality: 500, width: -3, background: "pink" }, info)).toEqual({
      format: "webp",
      quality: 100,
      width: 1,
      background: "white",
    });
    expect(normalizeSettings({}, info)).toEqual({ format: "webp", quality: 80, width: 800, background: "white" });
    expect(normalizeSettings({ quality: "high", width: "wide" }, info)).toMatchObject({ quality: 80, width: 800 });
  });
});

describe("outputName", () => {
  test("swaps the extension", () => {
    expect(outputName("holiday.png", "webp")).toBe("holiday.webp");
    expect(outputName("my.photo.v2.jpeg", "avif")).toBe("my.photo.v2.avif");
    expect(outputName("noext", "png")).toBe("noext.png");
  });
  test("avoids suggesting the source's own name", () => {
    expect(outputName("a.jpg", "jpeg")).toBe("a (converted).jpg");
    expect(outputName("a.JPEG", "jpeg")).toBe("a (converted).jpg");
    expect(outputName("a.png", "png")).toBe("a (converted).png");
  });
});
