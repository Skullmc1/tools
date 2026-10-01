import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { TEMP_ROOT } from "../paths.ts";

export type Upload = { id: string; name: string; path: string; size: number };

const STALE_MS = 24 * 60 * 60 * 1000;

/** Temp storage for uploads and results; everything in it is disposable. */
export class Workspace {
  readonly dir: string;
  private uploads = new Map<string, Upload>();

  constructor(private readonly root = TEMP_ROOT) {
    this.dir = join(root, `${process.pid}-${randomUUID().slice(0, 8)}`);
    mkdirSync(this.dir, { recursive: true });
  }

  /** Streams a request body to disk without holding it in memory. */
  async saveUpload(name: string, body: ReadableStream<Uint8Array>): Promise<Upload> {
    const id = randomUUID();
    const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
    const path = join(this.dir, `${id}${ext}`);
    const writer = Bun.file(path).writer();
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.byteLength;
        writer.write(chunk);
        await writer.flush();
      }
      await writer.end();
    } catch (error) {
      await Promise.resolve(writer.end()).catch(() => {});
      rmSync(path, { force: true });
      throw error;
    }
    const upload = { id, name, path, size };
    this.uploads.set(id, upload);
    return upload;
  }

  getUpload(id: string): Upload | undefined {
    return this.uploads.get(id);
  }

  removeUpload(id: string) {
    const upload = this.uploads.get(id);
    if (!upload) return;
    this.uploads.delete(id);
    rmSync(upload.path, { force: true });
  }

  /** A fresh path inside the workspace, e.g. for a tool's output. */
  tempPath(ext: string): string {
    return join(this.dir, `${randomUUID()}.${ext}`);
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Removes workspaces left behind by servers that did not exit cleanly. */
  sweepStale(now = Date.now()) {
    let entries: string[];
    try {
      entries = readdirSync(this.root);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(this.root, entry);
      if (path === this.dir) continue;
      try {
        if (now - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true });
      } catch {}
    }
  }
}
