import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { sse } from "./http.ts";

export type JobResult = {
  /** Temp file holding the output. */
  path: string;
  suggestedName: string;
  fileType: { label: string; ext: string };
  size: number;
  /** Tool-specific details shown in the UI. */
  meta: Record<string, unknown>;
};

export type JobEvent =
  | { type: "progress"; progress: number; note?: string; indeterminate?: boolean }
  | { type: "done"; result: Omit<JobResult, "path"> }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export type JobContext = {
  signal: AbortSignal;
  /** Pass null when a stage has no measurable progress. */
  progress: (fraction: number | null, note?: string) => void;
};

export type Job = {
  id: string;
  tool: string;
  last: JobEvent;
  result?: JobResult;
  savedPath?: string;
  controller: AbortController;
  listeners: Set<(event: JobEvent) => void>;
};

const isFinal = (event: JobEvent) => event.type !== "progress";

/**
 * Lets a job answer a cancel at once, even when the work underneath cannot be
 * interrupted. The work finishes in the background, so it must clean up after
 * itself.
 */
export function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  const cancelled = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Cancelled"));
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Cancelled")), { once: true });
  });
  return Promise.race([work, cancelled]);
}

export class JobStore {
  private jobs = new Map<string, Job>();

  /** `onSettled` runs once the work finishes, fails or is cancelled. */
  start(tool: string, work: (ctx: JobContext) => Promise<JobResult>, onSettled?: () => void): Job {
    const job: Job = {
      id: randomUUID(),
      tool,
      last: { type: "progress", progress: 0 },
      controller: new AbortController(),
      listeners: new Set(),
    };
    this.jobs.set(job.id, job);

    const emit = (event: JobEvent) => {
      if (isFinal(job.last)) return;
      job.last = event;
      for (const listener of job.listeners) listener(event);
    };

    work({
      signal: job.controller.signal,
      progress: (fraction, note) =>
        emit(
          fraction === null
            ? { type: "progress", progress: 0, note, indeterminate: true }
            : { type: "progress", progress: Math.max(0, Math.min(1, fraction)), note },
        ),
    })
      .then((result) => {
        if (job.controller.signal.aborted) {
          rmSync(result.path, { force: true });
          return emit({ type: "cancelled" });
        }
        job.result = result;
        const { path: _path, ...publicResult } = result;
        emit({ type: "done", result: publicResult });
      })
      .catch((error) => {
        if (job.controller.signal.aborted) emit({ type: "cancelled" });
        else emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      })
      .finally(onSettled);

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string) {
    this.jobs.get(id)?.controller.abort();
  }

  /** Cancels the job if it is running and deletes its output. */
  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.controller.abort();
    if (job.result) rmSync(job.result.path, { force: true });
    this.jobs.delete(id);
  }

  cancelAll() {
    for (const job of this.jobs.values()) job.controller.abort();
  }

  /** Streams the job's events, starting with its current state. */
  events(job: Job, req: Request): Response {
    return sse(req, (send, close) => {
      send(job.last);
      if (isFinal(job.last)) return close();
      const listener = (event: JobEvent) => {
        send(event);
        if (isFinal(event)) close();
      };
      job.listeners.add(listener);
      return () => job.listeners.delete(listener);
    });
  }
}
