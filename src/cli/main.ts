#!/usr/bin/env bun
// Entry point for the `tools` command. Imports only Bun/Node built-ins and
// dependency-free project files, so it can run before `bun install`.

import { getPlatform, UnsupportedPlatformError } from "../platform/index.ts";
import { manifests } from "../tools/manifests.ts";
import { ensureDependencies } from "./deps.ts";
import { ensureServer, stopServer } from "./launch.ts";

const USAGE = `tools - a local toolbox that opens in your browser

  tools          open the app (starts it in the background if needed)
  tools --stop   stop the background server
  tools --help   show this message`;

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (args[0] === "--stop") {
    console.log((await stopServer()) ? "tools: server stopped" : "tools: no server running");
    return 0;
  }
  if (args.length > 0) {
    console.error(`tools: unknown argument '${args[0]}'\n\n${USAGE}`);
    return 1;
  }

  const platform = await getPlatform();
  if (!(await ensureDependencies(platform, manifests))) return 1;

  const { port, reused } = await ensureServer();
  const url = `http://127.0.0.1:${port}/`;
  platform.openBrowser(url);
  console.log(`tools: ${reused ? "already running" : "started"} at ${url}`);
  return 0;
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof UnsupportedPlatformError) console.error(error.message);
  else console.error(`tools: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
