import { rmSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { ToolServer } from "../../server/context.ts";
import { HttpError, json, readJson } from "../../server/http.ts";
import type { Upload } from "../../server/workspace.ts";
import {
  buildGifArgs,
  encodeUnderTarget,
  estimateSample,
  type GifSettings,
  normalizeSettings,
  outputHeight,
  parseProbe,
  parseProgressSeconds,
  SettingsError,
  type VideoInfo,
} from "./ffmpeg.ts";

type Body = { uploadId?: string; settings?: unknown; targetMB?: unknown };

async function probe(path: string): Promise<VideoInfo> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_format", "-of", "json", path],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new SettingsError("This file could not be read as a video");
  return parseProbe(JSON.parse(out));
}

async function runFfmpeg(args: string[], signal: AbortSignal, onSeconds?: (seconds: number) => void) {
  const proc = Bun.spawn(["ffmpeg", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    signal,
  });
  const stderr = new Response(proc.stderr).text();
  const decoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    const seconds = parseProgressSeconds(decoder.decode(chunk));
    if (seconds !== null) onSeconds?.(seconds);
  }
  if ((await proc.exited) !== 0) {
    const tail = (await stderr).trim().split("\n").slice(-3).join("\n");
    throw new Error(tail || "ffmpeg failed");
  }
}

export const gifServer: ToolServer = {
  id: "gif",
  routes({ workspace, jobs, idle }) {
    const probes = new Map<string, Promise<VideoInfo>>();
    const estimates = new Map<string, AbortController>();

    async function resolve(body: Body): Promise<{ upload: Upload; info: VideoInfo; settings?: GifSettings }> {
      const upload = body.uploadId ? workspace.getUpload(body.uploadId) : undefined;
      if (!upload) throw new HttpError(404, "That upload is no longer available. Drop the file again.");
      try {
        let pending = probes.get(upload.id);
        if (!pending) probes.set(upload.id, (pending = probe(upload.path)));
        const info = await pending;
        return { upload, info, settings: body.settings ? normalizeSettings(body.settings, info) : undefined };
      } catch (error) {
        if (error instanceof SettingsError) throw new HttpError(400, error.message);
        throw error;
      }
    }

    return {
      "/api/gif/probe": {
        POST: async (req) => json((await resolve(await readJson<Body>(req))).info),
      },

      "/api/gif/estimate": {
        POST: async (req) => {
          const { upload, settings } = await resolve(await readJson<Body>(req));
          if (!settings) throw new HttpError(400, "Missing settings");

          // Only the newest estimate for a file matters.
          estimates.get(upload.id)?.abort();
          const controller = new AbortController();
          estimates.set(upload.id, controller);

          const sample = estimateSample(settings);
          const path = workspace.tempPath("gif");
          try {
            await runFfmpeg(buildGifArgs(upload.path, path, { ...settings, ...sample }), controller.signal);
            const scale = (settings.end - settings.start) / (sample.end - sample.start);
            return json({ bytes: Math.round(statSync(path).size * scale) });
          } catch (error) {
            if (controller.signal.aborted) return json({ superseded: true });
            throw error;
          } finally {
            rmSync(path, { force: true });
            if (estimates.get(upload.id) === controller) estimates.delete(upload.id);
          }
        },
      },

      "/api/gif/convert": {
        POST: async (req) => {
          const body = await readJson<Body>(req);
          const { upload, info, settings } = await resolve(body);
          if (!settings) throw new HttpError(400, "Missing settings");
          const targetBytes =
            typeof body.targetMB === "number" && body.targetMB > 0 ? Math.round(body.targetMB * 1024 * 1024) : null;

          const job = jobs.start(
            "gif",
            async ({ signal, progress }) => {
              const encode = async (s: GifSettings, attempt: number) => {
                const note = attempt > 1 ? `Too big. Retrying at ${s.width}px, ${s.fps} fps` : undefined;
                const path = workspace.tempPath("gif");
                progress(0, note);
                try {
                  await runFfmpeg(buildGifArgs(upload.path, path, s), signal, (seconds) =>
                    progress(seconds / (s.end - s.start), note),
                  );
                  return { path, bytes: statSync(path).size };
                } catch (error) {
                  rmSync(path, { force: true });
                  throw error;
                }
              };

              const outcome = targetBytes
                ? await encodeUnderTarget(settings, targetBytes, encode, (o) => rmSync(o.path, { force: true }))
                : { settings, output: await encode(settings, 1), attempts: 1, hit: true };

              return {
                path: outcome.output.path,
                suggestedName: `${basename(upload.name, extname(upload.name))}.gif`,
                fileType: { label: "GIF image", ext: "gif" },
                size: outcome.output.bytes,
                meta: {
                  width: outcome.settings.width,
                  height: outputHeight(outcome.settings.width, info),
                  fps: outcome.settings.fps,
                  duration: settings.end - settings.start,
                  attempts: outcome.attempts,
                  targetBytes,
                  hitTarget: outcome.hit,
                },
              };
            },
            idle.hold(),
          );
          return json({ jobId: job.id });
        },
      },
    };
  },
};
