import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp, { type Color } from "sharp";
import { applyMask, cutOut, ImageError, type Mask, probeImage, type Rgb, type Segmenter } from "../src/tools/bg-remove/pipeline.ts";

const dir = mkdtempSync(join(tmpdir(), "tools-bg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Keeps the left half of whatever it is given, at a tiny mask size. */
class LeftHalf implements Segmenter {
  seen: Rgb | null = null;
  async segment(image: Rgb): Promise<Mask> {
    this.seen = image;
    const [width, height] = [8, 8];
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width / 2; x++) data[y * width + x] = 255;
    return { data, width, height };
  }
}

const solid = (width: number, height: number, colour: Color) =>
  sharp({ create: { width, height, channels: 3, background: colour } });

async function readRgba(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
  return { info, alphaAt, data };
}

describe("applyMask", () => {
  test("scales alpha by the mask", () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 100, 10, 20, 30, 255]);
    applyMask(rgba, new Uint8Array([255, 0, 255, 128]));
    expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([255, 0, 100, 128]);
    expect(rgba.slice(0, 3)).toEqual(new Uint8Array([10, 20, 30]));
  });
});

describe("cutOut", () => {
  test("writes a transparent PNG at full resolution, with the mask stretched to fit", async () => {
    const input = join(dir, "photo.jpg");
    await solid(200, 100, "#3366cc").jpeg().toFile(input);
    const output = join(dir, "photo.png");
    const segmenter = new LeftHalf();

    const result = await cutOut(input, output, segmenter);

    expect(result).toMatchObject({ width: 200, height: 100 });
    expect(result.bytes).toBe(Bun.file(output).size);
    const png = await readRgba(output);
    expect(png.info).toMatchObject({ width: 200, height: 100 });
    expect(png.alphaAt(10, 50)).toBe(255);
    expect(png.alphaAt(190, 50)).toBe(0);
    // Colour is untouched where the subject is kept.
    expect([...png.data.slice((50 * 200 + 10) * 4, (50 * 200 + 10) * 4 + 3)]).toEqual([...(await readRgba(input)).data.slice((50 * 200 + 10) * 4, (50 * 200 + 10) * 4 + 3)]);
  });

  test("gives the model an opaque RGB copy no bigger than the model needs", async () => {
    const input = join(dir, "big.png");
    await solid(3000, 1500, "#aa5500").png().toFile(input);
    const segmenter = new LeftHalf();
    await cutOut(input, join(dir, "big-out.png"), segmenter);
    expect(segmenter.seen).toMatchObject({ width: 2048, height: 1024 });
    expect(segmenter.seen!.data.length).toBe(2048 * 1024 * 3);
  });

  test("keeps a picture's own transparency where the mask keeps the subject", async () => {
    const input = join(dir, "seethrough.png");
    const raw = Buffer.alloc(8 * 8 * 4, 255);
    for (let i = 0; i < 8 * 8; i++) raw[i * 4 + 3] = i % 8 < 2 ? 0 : 255; // two clear columns on the left
    await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } }).png().toFile(input);
    const output = join(dir, "seethrough-out.png");
    await cutOut(input, output, new LeftHalf());
    const png = await readRgba(output);
    expect(png.alphaAt(0, 4)).toBe(0); // clear in the source, kept by the mask
    expect(png.alphaAt(3, 4)).toBe(255);
    expect(png.alphaAt(6, 4)).toBe(0); // removed by the mask
  });

  test("applies a photo's rotation tag", async () => {
    const input = join(dir, "sideways.jpg");
    await solid(200, 100, "#00aa00").jpeg().withMetadata({ orientation: 6 }).toFile(input);
    expect(await probeImage(input)).toEqual({ width: 100, height: 200 });
    const output = join(dir, "sideways.png");
    expect(await cutOut(input, output, new LeftHalf())).toMatchObject({ width: 100, height: 200 });
  });

  test("stops when cancelled before the model runs", async () => {
    const input = join(dir, "cancel.png");
    await solid(20, 20, "#000000").png().toFile(input);
    const controller = new AbortController();
    controller.abort();
    const segmenter = new LeftHalf();
    await expect(cutOut(input, join(dir, "cancel-out.png"), segmenter, { signal: controller.signal })).rejects.toThrow();
    expect(segmenter.seen).toBeNull();
  });

  test("rejects a file that is not an image", async () => {
    const input = join(dir, "notes.png");
    await Bun.write(input, "this is not a picture");
    await expect(cutOut(input, join(dir, "x.png"), new LeftHalf())).rejects.toBeInstanceOf(ImageError);
  });
});

describe("probeImage", () => {
  test("reports the size of a plain image", async () => {
    const input = join(dir, "plain.webp");
    await solid(64, 48, "#ffffff").webp().toFile(input);
    expect(await probeImage(input)).toEqual({ width: 64, height: 48 });
  });

  test("rejects a file that is not an image", async () => {
    const input = join(dir, "text.jpg");
    await Bun.write(input, "hello");
    await expect(probeImage(input)).rejects.toThrow(/could not be read/i);
  });
});
