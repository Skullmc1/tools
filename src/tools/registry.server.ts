import type { ToolServer } from "../server/context.ts";
import { bgRemoveServer } from "./bg-remove/server.ts";
import { gifServer } from "./gif/server.ts";
import { imageConvertServer } from "./image-convert/server.ts";

// Add a tool's server half here.
export const toolServers: ToolServer[] = [gifServer, bgRemoveServer, imageConvertServer];
