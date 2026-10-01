import { rmSync, statSync } from "node:fs";
import type { ToolServer } from "../../server/context.ts";
import { HttpError, json, readJson } from "../../server/http.ts";
import { type ImageInfo, ImageError, inspectImage } from "../../server/image.ts";
import { raceAbort } from "../../server/jobs.ts";
import { convertImage, FORMATS, normalizeSettings, outputName } from "./convert.ts";

type Body = { uploadId?: unknown; settings?: unknown };

export const imageConvertServer: ToolServer = {
  id: "image-convert",
  routes({ workspace, jobs, idle }) {
    const inspected = new Map<string, Promise<ImageInfo>>();

    async function resolve(body: Body) {
      const upload = typeof body.uploadId === "string" ? workspace.getUpload(body.uploadId) : undefined;
      if (!upload) throw new HttpError(404, "That upload is no longer available. Drop the image again.");
      let pending = inspected.get(upload.id);
      if (!pending) inspected.set(upload.id, (pending = inspectImage(upload.path)));
      try {
        return { upload, info: await pending };
      } catch (error) {
        inspected.delete(upload.id);
        if (error instanceof ImageError) throw new HttpError(400, error.message);
        throw error;
      }
    }

    return {
      "/api/image-convert/probe": {
        POST: async (req) => json((await resolve(await readJson<Body>(req))).info),
      },

      "/api/image-convert/convert": {
        POST: async (req) => {
          const body = await readJson<Body>(req);
          const { upload, info } = await resolve(body);
          const settings = normalizeSettings(body.settings, info);
          const format = FORMATS[settings.format];

          const job = jobs.start(
            "image-convert",
            async ({ signal, progress }) => {
              const output = workspace.tempPath(format.ext);
              const work = async () => {
                try {
                  progress(null, "Converting");
                  const done = await convertImage(upload.path, output, settings, info, signal);
                  signal.throwIfAborted();
                  return {
                    path: output,
                    suggestedName: outputName(upload.name, settings.format),
                    fileType: { label: format.label, ext: format.ext },
                    size: statSync(output).size,
                    meta: { width: done.width, height: done.height, format: settings.format, quality: settings.quality },
                  };
                } catch (error) {
                  rmSync(output, { force: true });
                  throw error;
                }
              };
              return await raceAbort(signal, work());
            },
            idle.hold(),
          );
          return json({ jobId: job.id });
        },
      },
    };
  },
};
