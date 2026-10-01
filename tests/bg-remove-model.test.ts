import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type LoadedModel, type Loader, MODEL, ModelError, ModelHost } from "../src/tools/bg-remove/model.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "tools-model-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const IMAGE = { data: new Uint8Array(12), width: 2, height: 2 };
const modelPath = (dir: string) => join(dir, MODEL.id, MODEL.revision, MODEL.file);

function placeModel(dir: string, bytes = MODEL.bytes) {
  mkdirSync(dirname(modelPath(dir)), { recursive: true });
  writeFileSync(modelPath(dir), Buffer.alloc(bytes));
}

function fakeLoader() {
  const state = { loads: 0, disposed: 0, running: 0, maxRunning: 0 };
  const loader: Loader = async (_dir, onEvent) => {
    state.loads++;
    await Bun.sleep(20);
    onEvent({ phase: "download", loaded: 50, total: 100 });
    onEvent({ phase: "load" });
    const model: LoadedModel = {
      async run() {
        state.maxRunning = Math.max(state.maxRunning, ++state.running);
        await Bun.sleep(15);
        state.running--;
        return { data: new Uint8Array([255]), width: 1, height: 1 };
      },
      dispose: () => void state.disposed++,
    };
    return model;
  };
  return { state, loader };
}

describe("isDownloaded", () => {
  test("is false until the full model file is on disk", () => {
    const dir = tempDir();
    const host = new ModelHost({ dir, loader: fakeLoader().loader });
    expect(host.isDownloaded()).toBe(false);
    placeModel(dir, 1000); // a partial file does not count
    expect(host.isDownloaded()).toBe(false);
    placeModel(dir);
    expect(host.isDownloaded()).toBe(true);
  });
});

describe("loading", () => {
  test("loads once for any number of callers and reports progress to each", async () => {
    const { state, loader } = fakeLoader();
    const host = new ModelHost({ dir: tempDir(), loader });
    const seenA: string[] = [];
    const seenB: string[] = [];
    await Promise.all([
      host.ensureLoaded((e) => seenA.push(e.phase)),
      host.ensureLoaded((e) => seenB.push(e.phase)),
    ]);
    expect(state.loads).toBe(1);
    expect(seenA).toEqual(["download", "load"]);
    expect(seenB).toEqual(["download", "load"]);
    expect(host.isLoaded()).toBe(true);
    await host.ensureLoaded();
    expect(state.loads).toBe(1);
  });

  test("runs one image at a time", async () => {
    const { state, loader } = fakeLoader();
    const host = new ModelHost({ dir: tempDir(), loader });
    await Promise.all([host.segment(IMAGE), host.segment(IMAGE), host.segment(IMAGE)]);
    expect(state.maxRunning).toBe(1);
  });

  test("unloads after a quiet spell, and loads again when needed", async () => {
    const { state, loader } = fakeLoader();
    const host = new ModelHost({ dir: tempDir(), loader, idleMs: 40 });
    await host.segment(IMAGE);
    expect(host.isLoaded()).toBe(true);
    await Bun.sleep(120);
    expect(host.isLoaded()).toBe(false);
    expect(state.disposed).toBe(1);
    await host.segment(IMAGE);
    expect(state.loads).toBe(2);
    host.unload();
  });
});

describe("failures", () => {
  test("a failed first download says an internet connection is needed", async () => {
    const host = new ModelHost({
      dir: tempDir(),
      loader: async () => {
        throw new Error("fetch failed");
      },
    });
    const error = await host.ensureLoaded().catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.message).toMatch(/could not download.*fetch failed.*internet/i);
    expect(host.isLoaded()).toBe(false);
  });

  test("a failed load can be retried", async () => {
    let attempt = 0;
    const { loader } = fakeLoader();
    const host = new ModelHost({
      dir: tempDir(),
      loader: async (dir, onEvent) => {
        if (++attempt === 1) throw new Error("network down");
        return loader(dir, onEvent);
      },
    });
    await expect(host.ensureLoaded()).rejects.toThrow(ModelError);
    await host.ensureLoaded();
    expect(host.isLoaded()).toBe(true);
  });

  test("a saved model that will not load is deleted, so the next try downloads it afresh", async () => {
    const dir = tempDir();
    placeModel(dir);
    const host = new ModelHost({
      dir,
      loader: async () => {
        throw new Error("invalid protobuf");
      },
    });
    await expect(host.ensureLoaded()).rejects.toThrow(/was deleted/i);
    expect(existsSync(modelPath(dir))).toBe(false);
    expect(host.isDownloaded()).toBe(false);
  });
});

// The real thing: set TOOLS_TEST_MODEL=1 (and optionally TOOLS_TEST_MODEL_SEED
// to an existing cache folder, to skip the 109 MB download).
describe.skipIf(!process.env.TOOLS_TEST_MODEL)("the real model", () => {
  test("loads from a pinned revision and finds a subject", async () => {
    const dir = tempDir();
    // The seed is a transformers.js cache from an unpinned run; move its files
    // under the pinned revision, where this code looks for them.
    const seed = process.env.TOOLS_TEST_MODEL_SEED;
    if (seed) cpSync(join(seed, MODEL.id), join(dir, MODEL.id, MODEL.revision), { recursive: true });
    const host = new ModelHost({ dir, idleMs: 1000 });

    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#6b8fb3" } })
      .composite([{ input: { create: { width: 260, height: 300, channels: 3, background: "#c0392b" } }, left: 190, top: 90 }])
      .raw()
      .toBuffer({ resolveWithObject: true });

    const events: string[] = [];
    await host.ensureLoaded((e) => events.push(e.phase));
    expect(host.isDownloaded()).toBe(true);
    // A real download reports thousands of progress events; a cache hit, a handful.
    if (seed) expect(events.length).toBeLessThan(10);

    const mask = await host.segment({ data: new Uint8Array(data), width: info.width, height: info.height });
    expect(mask.width * mask.height).toBe(mask.data.length);
    const at = (fx: number, fy: number) => mask.data[Math.floor(fy * mask.height) * mask.width + Math.floor(fx * mask.width)]!;
    // A flat rectangle is not a natural subject, so compare rather than demand certainty.
    expect(at(0.5, 0.5)).toBeGreaterThan(at(0.05, 0.05) + 50); // the red block beats the backdrop
    expect(at(0.05, 0.05)).toBeLessThan(40); // the backdrop
    host.unload();
  }, 600_000);
});
