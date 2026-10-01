// Runs the real ffmpeg against a generated clip, through the tool's routes.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Handler } from "../src/server/http.ts";
import { IdleWatcher } from "../src/server/idle.ts";
import { type JobEvent, JobStore } from "../src/server/jobs.ts";
import { Workspace } from "../src/server/workspace.ts";
import { gifServer } from "../src/tools/gif/server.ts";

const root = mkdtempSync(join(tmpdir(), "tools-test-"));
const workspace = new Workspace(root);
const jobs = new JobStore();
const idle = new IdleWatcher(Infinity, () => {});
const routes = gifServer.routes({ workspace, jobs, idle }) as Record<string, { POST: Handler }>;
let uploadId: string;

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

async function probeGif(path: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
  const data = JSON.parse(await new Response(proc.stdout).text());
  const [num, den] = data.streams[0].r_frame_rate.split("/").map(Number);
  return {
    format: data.format.format_name as string,
    width: data.streams[0].width as number,
    height: data.streams[0].height as number,
    fps: num / den,
    duration: Number(data.format.duration),
  };
}

beforeAll(async () => {
  // 3 seconds of 640x360 test pattern at 30 fps.
  const clip = join(root, "clip.mp4");
  const make = Bun.spawn(
    ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-pix_fmt", "yuv420p", clip],
    { stderr: "inherit" },
  );
  expect(await make.exited).toBe(0);
  uploadId = (await workspace.saveUpload("my clip.mp4", Bun.file(clip).stream())).id;
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("probe reports the source's size and length", async () => {
  const info = await post<any>("/api/gif/probe", { uploadId });
  expect(info).toMatchObject({ width: 640, height: 360, fps: 30 });
  expect(info.duration).toBeCloseTo(3, 1);
});

test("convert produces a GIF with the requested trim, width and fps", async () => {
  const settings = { start: 0.5, end: 2.5, fps: 10, width: 320, quality: "medium" };
  const { jobId } = await post<{ jobId: string }>("/api/gif/convert", { uploadId, settings });
  const event = await finished(jobId);
  expect(event.type).toBe("done");

  const result = jobs.get(jobId)!.result!;
  expect(result.suggestedName).toBe("my clip.gif");
  expect(result.meta).toMatchObject({ width: 320, height: 180, fps: 10, attempts: 1 });

  const gif = await probeGif(result.path);
  expect(gif.format).toBe("gif");
  expect(gif).toMatchObject({ width: 320, height: 180, fps: 10 });
  expect(gif.duration).toBeCloseTo(2, 1);
  expect(result.size).toBe(Bun.file(result.path).size);
});

test("estimate lands near the real size", async () => {
  const settings = { start: 0, end: 3, fps: 10, width: 320, quality: "medium" };
  const { bytes } = await post<{ bytes: number }>("/api/gif/estimate", { uploadId, settings });
  const { jobId } = await post<{ jobId: string }>("/api/gif/convert", { uploadId, settings });
  await finished(jobId);
  const actual = jobs.get(jobId)!.result!.size;
  expect(bytes).toBeGreaterThan(actual * 0.5);
  expect(bytes).toBeLessThan(actual * 2);
});

test("a size target shrinks the output until it fits", async () => {
  const settings = { start: 0, end: 3, fps: 15, width: 640, quality: "high" };
  const full = await post<{ jobId: string }>("/api/gif/convert", { uploadId, settings });
  await finished(full.jobId);
  const fullSize = jobs.get(full.jobId)!.result!.size;

  const targetMB = fullSize / 3 / 1024 / 1024;
  const { jobId } = await post<{ jobId: string }>("/api/gif/convert", { uploadId, settings, targetMB });
  await finished(jobId);
  const result = jobs.get(jobId)!.result!;
  expect(result.size).toBeLessThanOrEqual(fullSize / 3);
  expect(result.meta.hitTarget).toBe(true);
  expect(result.meta.attempts as number).toBeGreaterThan(1);
  expect(result.meta.width as number).toBeLessThan(640);
});

test("a file with no video is rejected with a clear message", async () => {
  const text = await workspace.saveUpload("notes.mp4", new Blob(["not a video"]).stream());
  expect(post("/api/gif/probe", { uploadId: text.id })).rejects.toThrow(/could not be read|no video/i);
});

test("an unknown upload is rejected", async () => {
  expect(post("/api/gif/probe", { uploadId: "nope" })).rejects.toThrow(/no longer available/i);
});
