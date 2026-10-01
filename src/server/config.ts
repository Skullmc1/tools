import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_FILE } from "../paths.ts";

export type Config = { lastSaveDir?: string };

export class ConfigStore {
  constructor(private readonly file = CONFIG_FILE) {}

  read(): Config {
    try {
      return JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  update(patch: Partial<Config>) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ ...this.read(), ...patch }, null, 2));
  }
}
