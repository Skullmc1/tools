import type { ToolServer } from "../server/context.ts";
import { gifServer } from "./gif/server.ts";

// Add a tool's server half here.
export const toolServers: ToolServer[] = [gifServer];
