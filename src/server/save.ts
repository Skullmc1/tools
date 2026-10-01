import { copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Platform } from "../platform/index.ts";
import type { ConfigStore } from "./config.ts";
import { HttpError } from "./http.ts";
import type { Job } from "./jobs.ts";

export type SaveOutcome = { saved: false } | { saved: true; path: string };

/**
 * Asks where to save a finished job's output and copies it there. The
 * destination only ever comes from the native dialog, never from a request.
 */
export async function saveJobResult(
  job: Job,
  platform: Pick<Platform, "saveDialog">,
  config: ConfigStore,
): Promise<SaveOutcome> {
  const result = job.result;
  if (!result) throw new HttpError(409, "This job has no finished result to save");

  const destination = await platform.saveDialog({
    suggestedName: result.suggestedName,
    initialDir: config.read().lastSaveDir,
    fileType: result.fileType,
  });
  if (!destination) return { saved: false };

  try {
    // Copy rather than move so the result can be saved again elsewhere.
    await copyFile(result.path, destination);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(500, `Could not write to ${destination}: ${reason}`);
  }
  job.savedPath = destination;
  config.update({ lastSaveDir: dirname(destination) });
  return { saved: true, path: destination };
}
