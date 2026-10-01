// The tool's routes end to end, with a stand-in for the model.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Handler } from "../src/server/http.ts";
import { IdleWatcher } from "../src/server/idle.ts";
import { type JobEvent, JobStore } from "../src/server/jobs.ts";
import { Workspace } from "../src/server/workspace.ts";
import { type LoadEvent, ModelError } from "../src/tools/bg-remove/model.ts";
import type { Mask, Rgb } from "../src/tools/bg-remove/pipeline.ts";
import { createBgRemoveServer, type Engine } from "../src/tools/bg-remove/server.ts";

sharp.cache(false);

const root = mkdtempSync(join(tmpdir(), "tools-bgserver-"));
const workspace = new Workspace(root);
const jobs = new JobStore();
const idle = new IdleWatcher(Infinity, () => {});

/** Keeps the left half; can be told to fail, stall or report a download. */
class FakeEngine implements Engine {
  downloaded = false;
  loaded = false;
  failLoad: string | null = null;
  stall: Promise<void> | null = null;
  async ensureLoaded(onEvent: (event: LoadEvent) => void = () => {}) {
    await Bun.sleep(30); // a real load takes time; this lets a listener attach
    if (this.loaded) return;
    if (this.failLoad) throw new ModelError(this.failLoad);
    if (!this.downloaded) {
      onEvent({ phase: "download", loaded: 50, total: 100 });
      await Bun.sleep(10);
      onEvent({ phase: "download", loaded: 100, total: 100 });
      this.downloaded = true;
    }
    onEvent({ phase: "load" });
    this.loaded = true;
  }
  isDownloaded = () => this.downloaded;
  isLoaded = () => this.loaded;
  async segment(_image: Rgb): Promise<Mask> {
    await Bun.sleep(30);
    await this.stall;
    const data = new Uint8Array(16 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) data[y * 16 + x] = 255;
    return { data, width: 16, height: 16 };
  }
}

const engine = new FakeEngine();
const routes = createBgRemoveServer(engine).routes({ workspace, jobs, idle }) as Record<string, { GET?: Handler; POST?: Handler }>;
let uploadId: string;

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const req = new Request(`http://127.0.0.1${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await routes[path]![method]!(req as any, undefined as any);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

/** Every event the job emits, until it ends. */
function events(jobId: string): Promise<JobEvent[]> {
  const job = jobs.get(jobId)!;
  const seen: JobEvent[] = [job.last];
  return new Promise((resolve) => {
    if (job.last.type !== "progress") return resolve(seen);
    job.listeners.add((event) => {
      seen.push(event);
      if (event.type !== "progress") resolve(seen);
    });
  });
}

beforeAll(async () => {
  const file = join(root, "photo.jpg");
  await sharp({ create: { width: 120, height: 80, channels: 3, background: "#3366cc" } }).jpeg().toFile(file);
  uploadId = (await workspace.saveUpload("Holiday photo.jpg", Bun.file(file).stream())).id;
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

test("status says whether the model is on this machine", async () => {
  expect(await call<unknown>("GET", "/api/bg-remove/status")).toMatchObject({ downloaded: false, loaded: false, modelMB: 109 });
});

test("probe reports the image's size", async () => {
  expect(await call<unknown>("POST", "/api/bg-remove/probe", { uploadId })).toEqual({ width: 120, height: 80 });
});

test("probe and convert reject an unknown upload", async () => {
  await expect(call("POST", "/api/bg-remove/probe", { uploadId: "nope" })).rejects.toThrow(/no longer available/i);
  await expect(call("POST", "/api/bg-remove/convert", {})).rejects.toThrow(/no longer available/i);
});

test("probe rejects a file that is not an image", async () => {
  const text = await workspace.saveUpload("notes.png", new Blob(["not an image"]).stream());
  await expect(call("POST", "/api/bg-remove/probe", { uploadId: text.id })).rejects.toThrow(/could not be read/i);
});

test("convert downloads on first use, then cuts the subject out as a transparent PNG", async () => {
  const { jobId } = await call<{ jobId: string }>("POST", "/api/bg-remove/convert", { uploadId });
  const seen = await events(jobId);
  expect(seen.at(-1)?.type).toBe("done");

  const progress = seen.filter((e): e is Extract<JobEvent, { type: "progress" }> => e.type === "progress");
  expect(progress.some((e) => /downloading the model/i.test(e.note ?? ""))).toBe(true);
  expect(progress.some((e) => e.indeterminate && /removing the background/i.test(e.note ?? ""))).toBe(true);

  const result = jobs.get(jobId)!.result!;
  expect(result.suggestedName).toBe("Holiday photo (no background).png");
  expect(result.fileType).toEqual({ label: "PNG image", ext: "png" });
  expect(result.meta).toMatchObject({ width: 120, height: 80 });
  expect(result.size).toBe(Bun.file(result.path).size);

  const { data, info } = await sharp(result.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 120, height: 80 });
  expect(data[(40 * 120 + 10) * 4 + 3]).toBe(255);
  expect(data[(40 * 120 + 110) * 4 + 3]).toBe(0);
  expect(await call<unknown>("GET", "/api/bg-remove/status")).toMatchObject({ downloaded: true, loaded: true });
});

test("a later run does not talk about downloading", async () => {
  const { jobId } = await call<{ jobId: string }>("POST", "/api/bg-remove/convert", { uploadId });
  const seen = await events(jobId);
  expect(seen.at(-1)?.type).toBe("done");
  expect(seen.some((e) => e.type === "progress" && /download/i.test(e.note ?? ""))).toBe(false);
});

test("a model failure reaches the job as a clear error and leaves no output behind", async () => {
  const failing = new FakeEngine();
  failing.failLoad = "Could not download the model (fetch failed). An internet connection is needed the first time only.";
  const failingRoutes = createBgRemoveServer(failing).routes({ workspace, jobs, idle }) as typeof routes;
  const before = readdirSync(workspace.dir).length;

  const req = new Request("http://127.0.0.1/api/bg-remove/convert", { method: "POST", body: JSON.stringify({ uploadId }) });
  const { jobId } = await (await failingRoutes["/api/bg-remove/convert"]!.POST!(req as any, undefined as any)).json();
  const last = (await events(jobId)).at(-1)!;

  expect(last).toMatchObject({ type: "error" });
  expect((last as Extract<JobEvent, { type: "error" }>).message).toMatch(/internet connection/i);
  expect(readdirSync(workspace.dir).length).toBe(before);
});

test("cancelling returns at once, even while the model is busy, and cleans up", async () => {
  let release!: () => void;
  engine.stall = new Promise((resolve) => (release = resolve));
  const before = readdirSync(workspace.dir).filter((f) => f.endsWith(".png")).length;

  const { jobId } = await call<{ jobId: string }>("POST", "/api/bg-remove/convert", { uploadId });
  await Bun.sleep(150); // let it reach the model
  jobs.cancel(jobId);
  const last = (await events(jobId)).at(-1)!;
  expect(last.type).toBe("cancelled");

  release();
  engine.stall = null;
  await Bun.sleep(300); // the abandoned work finishes and removes its own output
  const after = readdirSync(workspace.dir).filter((f) => f.endsWith(".png")).filter((f) => existsSync(join(workspace.dir, f))).length;
  expect(after).toBe(before);
  expect(jobs.get(jobId)!.result).toBeUndefined();
});
