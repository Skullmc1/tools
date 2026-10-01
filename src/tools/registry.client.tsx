import type { ComponentType } from "react";
import { GifTool } from "./gif/ui.tsx";
import type { ToolManifest } from "./manifests.ts";

// Add a tool's screen here, keyed by its manifest id.
export const toolScreens: Record<string, ComponentType<{ manifest: ToolManifest }>> = {
  gif: GifTool,
};
