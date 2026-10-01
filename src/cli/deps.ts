import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../paths.ts";
import type { Platform, SystemPackage } from "../platform/index.ts";
import type { ToolManifest } from "../tools/manifests.ts";

export type DepCheck = { missingPackages: string[]; missingBinaries: string[] };

export type DepProbe = {
  /** Names from package.json "dependencies". */
  packages: string[];
  binaries: string[];
  hasPackage: (name: string) => boolean;
  which: (binary: string) => string | null;
};

export function requiredBinaries(manifests: ToolManifest[]): string[] {
  return [...new Set(manifests.flatMap((m) => m.requires))];
}

export function checkDependencies(probe: DepProbe): DepCheck {
  return {
    missingPackages: probe.packages.filter((name) => !probe.hasPackage(name)),
    missingBinaries: probe.binaries.filter((name) => !probe.which(name)),
  };
}

export function isSatisfied(check: DepCheck): boolean {
  return check.missingPackages.length === 0 && check.missingBinaries.length === 0;
}

function realProbe(binaries: string[], path?: string): DepProbe {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
  return {
    packages: Object.keys(pkg.dependencies ?? {}),
    binaries,
    hasPackage: (name) => existsSync(join(PROJECT_ROOT, "node_modules", name, "package.json")),
    which: (binary) => Bun.which(binary, path ? { PATH: path } : undefined),
  };
}

/**
 * Makes sure everything the tools need is installed, running setup if not.
 * Returns false when setup could not finish; the reason has been printed.
 */
export async function ensureDependencies(platform: Platform, manifests: ToolManifest[]): Promise<boolean> {
  const binaries = requiredBinaries(manifests);
  let check = checkDependencies(realProbe(binaries));
  if (isSatisfied(check)) return true;

  console.log("tools: first-time setup");

  if (check.missingPackages.length > 0) {
    console.log(`  Installing packages (${check.missingPackages.join(", ")})...`);
    const install = Bun.spawn([process.execPath, "install"], {
      cwd: PROJECT_ROOT,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      console.error(`  'bun install' failed. Run it yourself in ${PROJECT_ROOT} to see why.`);
      return false;
    }
  }

  if (check.missingBinaries.length > 0) {
    const unknown = check.missingBinaries.filter((b) => !platform.packageFor(b));
    if (unknown.length > 0) {
      console.error(`  Missing programs with no known installer: ${unknown.join(", ")}. Install them and run 'tools' again.`);
      return false;
    }
    const packages = new Map<string, SystemPackage>();
    for (const binary of check.missingBinaries) {
      const pkg = platform.packageFor(binary)!;
      packages.set(pkg.id, pkg);
    }
    const labels = [...packages.values()].map((p) => p.label).join(", ");
    console.log(`  Missing: ${check.missingBinaries.join(", ")}`);

    if (!confirm(`  Install ${labels} now?`)) {
      console.log("  Not installed. To do it yourself:");
      for (const pkg of packages.values()) console.log(`    ${platform.installCommand(pkg)}`);
      return false;
    }
    for (const pkg of packages.values()) {
      if (!(await platform.installPackage(pkg))) {
        console.error(`  Installing ${pkg.label} failed. Try: ${platform.installCommand(pkg)}`);
        return false;
      }
    }
    // The installer changed PATH for new terminals; pick that up here too.
    const path = await platform.freshPath();
    if (path) process.env.PATH = path;
  }

  check = checkDependencies(realProbe(binaries, process.env.PATH));
  if (isSatisfied(check)) {
    console.log("  Setup complete.");
    return true;
  }
  const still = [...check.missingPackages, ...check.missingBinaries].join(", ");
  console.error(`  Still missing after setup: ${still}. Open a new terminal and run 'tools' again.`);
  return false;
}
