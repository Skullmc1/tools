// The tool's routes end to end, against real images.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Handler } from "../src/server/http.ts";
import { IdleWatcher } from "../src/server/idle.ts";
import { type JobEvent, JobStore } from "../src/server/jobs.ts";
import { Workspace } from "../src/server/workspace.ts";
import { imageConvertServer } from "../src/tools/image-convert/server.ts";

const root = mkdtempSync(join(tmpdir(), "tools-imgserver-"));
const workspace = new Workspace(root);
const jobs = new JobStore();
const idle = new IdleWatcher(Infinity, () => {});
const routes = imageConvertServer.routes({ workspace, jobs, idle }) as Record<string, { POST: Handler }>;
let photo: string;
let png: string;

async function post<T>(path: string, body: unknown): Promise<T> {
  const req = new Request(`http://127.0.0.1${path}`, { method: "POST", body: JSON.stringify(body) });
  const res = await routes[path]!.POST(req as any, undefined as any);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

function finished(jobId: string): Promise<JobEvent> {
  const job = jobs.get(jobId)!;
  return new Promise((resolve) => {
    if (job.last.type !== "progress") return resolve(job.last);
    job.listeners.add((event) => event.type !== "progress" && resolve(event));
  });
}

beforeAll(async () => {
  const file = join(root, "src.png");
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#888888", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .png()
    .toFile(file);
  photo = (await workspace.saveUpload("Summer trip.png", Bun.file(file).stream())).id;
  const jpg = join(root, "src.jpg");
  await sharp(file).jpeg().toFile(jpg);
  png = (await workspace.saveUpload("Summer trip.jpg", Bun.file(jpg).stream())).id;
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

test("probe describes the image", async () => {
  expect(await post<unknown>("/api/image-convert/probe", { uploadId: photo })).toEqual({ width: 300, height: 200, hasAlpha: false, format: "png" });
});

test("probe rejects unknown uploads and non-images", async () => {
  await expect(post("/api/image-convert/probe", { uploadId: "nope" })).rejects.toThrow(/no longer available/i);
  const text = await workspace.saveUpload("notes.png", new Blob(["not an image"]).stream());
  await expect(post("/api/image-convert/probe", { uploadId: text.id })).rejects.toThrow(/could not be read/i);
});

test("convert makes the requested format, size and name", async () => {
  const { jobId } = await post<{ jobId: string }>("/api/image-convert/convert", {
    uploadId: photo,
    settings: { format: "webp", quality: 60, width: 150 },
  });
  expect((await finished(jobId)).type).toBe("done");
  const result = jobs.get(jobId)!.result!;
  expect(result.suggestedName).toBe("Summer trip.webp");
  expect(result.fileType).toEqual({ label: "WebP image", ext: "webp" });
  expect(result.meta).toMatchObject({ width: 150, height: 100, format: "webp", quality: 60 });
  expect(result.size).toBe(Bun.file(result.path).size);
  expect(await sharp(result.path).metadata()).toMatchObject({ format: "webp", width: 150, height: 100 });
});

test("converting to the source's own format suggests a different name", async () => {
  const { jobId } = await post<{ jobId: string }>("/api/image-convert/convert", { uploadId: png, settings: { format: "jpeg", quality: 50 } });
  await finished(jobId);
  expect(jobs.get(jobId)!.result!.suggestedName).toBe("Summer trip (converted).jpg");
});

test("junk settings fall back to safe ones", async () => {
  const { jobId } = await post<{ jobId: string }>("/api/image-convert/convert", { uploadId: photo, settings: { format: "bmp", quality: 9999, width: "x" } });
  expect((await finished(jobId)).type).toBe("done");
  expect(jobs.get(jobId)!.result!.meta).toMatchObject({ format: "webp", quality: 100, width: 300 });
});

test("cancelling answers at once and leaves no output behind", async () => {
  const { jobId } = await post<{ jobId: string }>("/api/image-convert/convert", { uploadId: photo, settings: { format: "avif", quality: 90 } });
  jobs.cancel(jobId);
  expect((await finished(jobId)).type).toBe("cancelled");
  await Bun.sleep(1500); // the abandoned encode finishes and removes its own file
  jobs.remove(jobId);
  expect(readdirSync(workspace.dir).filter((f) => f.endsWith(".avif"))).toEqual([]);
});
