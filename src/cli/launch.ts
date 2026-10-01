import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ID, LOG_FILE, PROJECT_ROOT, SERVER_STATE_FILE, STATE_DIR, type ServerState } from "../paths.ts";

const START_TIMEOUT_MS = 20_000;

function readState(): ServerState | null {
  try {
    return JSON.parse(readFileSync(SERVER_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function isOurs(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok && (await res.json()).app === APP_ID;
  } catch {
    return false;
  }
}

/** The running server, if there is one and it answers. */
export async function findServer(): Promise<ServerState | null> {
  const state = readState();
  return state && (await isOurs(state.port)) ? state : null;
}

export async function ensureServer(): Promise<{ port: number; reused: boolean }> {
  const running = await findServer();
  if (running) return { port: running.port, reused: true };

  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(LOG_FILE, "a");
  spawn(process.execPath, [join(PROJECT_ROOT, "src", "server", "main.ts")], {
    cwd: PROJECT_ROOT, // bunfig.toml is read from the working directory
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
    env: process.env,
  }).unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    const started = await findServer();
    if (started) return { port: started.port, reused: false };
  }
  throw new Error(`The server did not start. See ${LOG_FILE}`);
}

export async function stopServer(): Promise<boolean> {
  const running = await findServer();
  if (!running) return false;
  await fetch(`http://127.0.0.1:${running.port}/api/shutdown`, { method: "POST" }).catch(() => {});
  return true;
}
