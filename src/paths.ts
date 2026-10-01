import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const APP_ID = "tools-app";
export const PROJECT_ROOT = resolve(import.meta.dir, "..");

export const STATE_DIR = process.env.TOOLS_STATE_DIR ?? join(homedir(), ".tools");
export const SERVER_STATE_FILE = join(STATE_DIR, "server.json");
export const CONFIG_FILE = join(STATE_DIR, "config.json");
export const LOG_FILE = join(STATE_DIR, "server.log");
export const MODELS_DIR = process.env.TOOLS_MODELS_DIR ?? join(STATE_DIR, "models");

export const TEMP_ROOT = join(tmpdir(), "tools-app");

export const DEFAULT_PORT = 4777;
export const PORT_ATTEMPTS = 20;

export type ServerState = { pid: number; port: number; startedAt: string };
