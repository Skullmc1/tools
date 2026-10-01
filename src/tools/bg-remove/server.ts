import { rmSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { ToolServer } from "../../server/context.ts";
import { HttpError, json, readJson } from "../../server/http.ts";
import { type LoadEvent, MODEL, ModelHost } from "./model.ts";
import { cutOut, ImageError, probeImage, type Segmenter } from "./pipeline.ts";

/** What the server needs from the model, so tests can stand one in. */
export type Engine = Segmenter & {
  isDownloaded(): boolean;
  isLoaded(): boolean;
  ensureLoaded(onEvent?: (event: LoadEvent) => void): Promise<void>;
};

const MB = 1024 * 1024;
const DOWNLOAD_SHARE = 0.85; // of the bar; the rest is loading and running

export function createBgRemoveServer(engine: Engine): ToolServer {
  return {
    id: "bg-remove",
    routes({ workspace, jobs, idle }) {
      const uploadFor = (uploadId: unknown) => {
        const upload = typeof uploadId === "string" ? workspace.getUpload(uploadId) : undefined;
        if (!upload) throw new HttpError(404, "That upload is no longer available. Drop the image again.");
        return upload;
      };

      return {
        "/api/bg-remove/status": {
          GET: () =>
            json({ downloaded: engine.isDownloaded(), loaded: engine.isLoaded(), modelMB: Math.round(MODEL.bytes / MB) }),
        },

        "/api/bg-remove/probe": {
          POST: async (req) => {
            const { uploadId } = await readJson<{ uploadId?: string }>(req);
            try {
              return json(await probeImage(uploadFor(uploadId).path));
            } catch (error) {
              if (error instanceof ImageError) throw new HttpError(400, error.message);
              throw error;
            }
          },
        },

        "/api/bg-remove/convert": {
          POST: async (req) => {
            const { uploadId } = await readJson<{ uploadId?: string }>(req);
            const upload = uploadFor(uploadId);

            const job = jobs.start(
              "bg-remove",
              async ({ signal, progress }) => {
                const output = workspace.tempPath("png");

                const work = async () => {
                  try {
                    if (!engine.isLoaded()) {
                      const firstTime = !engine.isDownloaded();
                      progress(firstTime ? 0 : null, firstTime ? "Downloading the model, first time only" : "Loading the model");
                      await engine.ensureLoaded((event) => {
                        if (event.phase === "download") {
                          // A cached model still reports one progress event; that is not a download.
                          if (!firstTime) return;
                          progress(
                            (event.loaded / event.total) * DOWNLOAD_SHARE,
                            `Downloading the model, first time only: ${Math.round(event.loaded / MB)} of ${Math.round(event.total / MB)} MB`,
                          );
                        } else progress(null, "Loading the model");
                      });
                    }
                    signal.throwIfAborted();

                    const started = performance.now();
                    const size = await cutOut(upload.path, output, engine, {
                      signal,
                      beforeSegment: () => progress(null, "Removing the background"),
                    });
                    signal.throwIfAborted();

                    return {
                      path: output,
                      suggestedName: `${basename(upload.name, extname(upload.name))} (no background).png`,
                      fileType: { label: "PNG image", ext: "png" },
                      size: statSync(output).size,
                      meta: { width: size.width, height: size.height, seconds: (performance.now() - started) / 1000 },
                    };
                  } catch (error) {
                    rmSync(output, { force: true });
                    throw error;
                  }
                };

                // Cancelling returns at once. A download already under way
                // finishes quietly, and the next run reuses it.
                const cancelled = new Promise<never>((_, reject) =>
                  signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Cancelled"))),
                );
                return await Promise.race([work(), cancelled]);
              },
              idle.hold(),
            );
            return json({ jobId: job.id });
          },
        },
      };
    },
  };
}

export const bgRemoveServer = createBgRemoveServer(new ModelHost());
