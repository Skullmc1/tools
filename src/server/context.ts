import type { Routes } from "./http.ts";
import type { IdleWatcher } from "./idle.ts";
import type { JobStore } from "./jobs.ts";
import type { Workspace } from "./workspace.ts";

/** What the server hands every tool. */
export type ToolContext = { workspace: Workspace; jobs: JobStore; idle: IdleWatcher };

/** A tool's server half. Its routes live under /api/<id>/. */
export type ToolServer = { id: string; routes: (ctx: ToolContext) => Routes };
