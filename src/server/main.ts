import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "bun";
import {
  APP_ID,
  DEFAULT_PORT,
  PORT_ATTEMPTS,
  SERVER_STATE_FILE,
  STATE_DIR,
  type ServerState,
} from "../paths.ts";
import { getPlatform } from "../platform/index.ts";
import { toolServers } from "../tools/registry.server.ts";
import index from "../web/index.html";
import { ConfigStore } from "./config.ts";
import type { ToolContext } from "./context.ts";
import { guardRoutes, HttpError, json, type Routes, sse } from "./http.ts";
import { IdleWatcher } from "./idle.ts";
import { type Job, JobStore } from "./jobs.ts";
import { saveJobResult } from "./save.ts";
import { Workspace } from "./workspace.ts";

const dev = process.argv.includes("--dev");
const IDLE_MS = dev ? Infinity : Number(process.env.TOOLS_IDLE_MS ?? 5 * 60_000);
const MAX_UPLOAD_BYTES = 32 * 1024 ** 3;

const platform = await getPlatform();
const config = new ConfigStore();
const workspace = new Workspace();
workspace.sweepStale();
const jobs = new JobStore();
const idle = new IdleWatcher(IDLE_MS, () => shutdown("idle"));
const ctx: ToolContext = { workspace, jobs, idle };

function requireJob(id: string | undefined): Job {
  const job = id ? jobs.get(id) : undefined;
  if (!job) throw new HttpError(404, "That result is no longer available");
  return job;
}

const coreRoutes: Routes = {
  "/api/health": { GET: () => json({ app: APP_ID, pid: process.pid }) },

  // Each open tab holds one of these; the server stays up while any exist.
  "/api/presence": {
    GET: (req) =>
      sse(req, (send) => {
        send({ ok: true });
        return idle.hold();
      }),
  },

  "/api/shutdown": {
    POST: () => {
      setTimeout(() => shutdown("requested"), 50);
      return json({ ok: true });
    },
  },

  "/api/uploads": {
    POST: async (req) => {
      const name = new URL(req.url).searchParams.get("name");
      if (!name || !req.body) throw new HttpError(400, "Expected a file body and a name");
      const release = idle.hold();
      try {
        const { id, size } = await workspace.saveUpload(name, req.body);
        return json({ uploadId: id, name, size });
      } finally {
        release();
      }
    },
  },

  "/api/uploads/:id": {
    DELETE: (req) => {
      workspace.removeUpload(req.params.id!);
      return json({ ok: true });
    },
  },

  "/api/jobs/:id": {
    DELETE: (req) => {
      jobs.remove(req.params.id!);
      return json({ ok: true });
    },
  },

  "/api/jobs/:id/events": { GET: (req) => jobs.events(requireJob(req.params.id), req) },

  "/api/jobs/:id/cancel": {
    POST: (req) => {
      jobs.cancel(req.params.id!);
      return json({ ok: true });
    },
  },

  "/api/jobs/:id/result": {
    GET: (req) => {
      const { result } = requireJob(req.params.id);
      if (!result) throw new HttpError(409, "This job has not finished");
      return new Response(Bun.file(result.path), { headers: { "cache-control": "no-store" } });
    },
  },

  "/api/jobs/:id/save": {
    POST: async (req) => {
      const release = idle.hold();
      try {
        return json(await saveJobResult(requireJob(req.params.id), platform, config));
      } finally {
        release();
      }
    },
  },

  "/api/jobs/:id/reveal": {
    POST: (req) => {
      const { savedPath } = requireJob(req.params.id);
      if (!savedPath) throw new HttpError(409, "This result has not been saved yet");
      platform.revealInFileManager(savedPath);
      return json({ ok: true });
    },
  },
};

const routes = {
  ...guardRoutes({ ...coreRoutes, ...Object.assign({}, ...toolServers.map((tool) => tool.routes(ctx))) }),
  "/api/*": () => json({ error: "Not found" }, 404),
  "/*": index,
};

function listen(): Server<unknown> {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_ATTEMPTS; port++) {
    try {
      return Bun.serve({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 0, // event streams and the Save dialog stay open for a long time
        maxRequestBodySize: MAX_UPLOAD_BYTES,
        development: dev,
        routes: routes as any,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`No free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_ATTEMPTS - 1}`);
}

const server = listen();
const state: ServerState = { pid: process.pid, port: server.port!, startedAt: new Date().toISOString() };
mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(SERVER_STATE_FILE, JSON.stringify(state));
console.log(`[${state.startedAt}] listening on http://127.0.0.1:${state.port} (pid ${state.pid})`);

let stopping = false;
function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[${new Date().toISOString()}] shutting down (${reason})`);
  idle.stop();
  jobs.cancelAll();
  try {
    // Leave the file alone if a newer server has already taken over.
    if (JSON.parse(readFileSync(SERVER_STATE_FILE, "utf8")).pid === process.pid) rmSync(SERVER_STATE_FILE);
  } catch {}
  workspace.cleanup();
  void server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
