import type { JobEvent } from "../server/jobs.ts";

export type { JobEvent };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }),
  /** Cleanup calls: nothing useful to do if they fail. */
  discard: (path: string) => void fetch(path, { method: "DELETE", keepalive: true }).catch(() => {}),
};

export type UploadResult = { uploadId: string; name: string; size: number };

/** XHR rather than fetch, because fetch cannot report upload progress. */
export function uploadFile(file: File, onProgress: (fraction: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open("POST", `/api/uploads?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status === 200 ? resolve(xhr.response) : reject(new Error(xhr.response?.error ?? "Upload failed"));
    xhr.onerror = () => reject(new Error("Could not reach the tools server. Run `tools` again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Follows a job until it ends. Returns a function that stops listening. */
export function watchJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as JobEvent;
    if (event.type !== "progress") source.close();
    onEvent(event);
  };
  source.onerror = () => {
    source.close();
    onEvent({ type: "error", message: "Lost contact with the tools server. Run `tools` again." });
  };
  return () => source.close();
}

/** Keeps the server alive while this tab is open; reports whether it answers. */
export function connectPresence(onChange: (online: boolean) => void): () => void {
  const source = new EventSource("/api/presence");
  source.onopen = () => onChange(true);
  source.onerror = () => onChange(false);
  return () => source.close();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}
