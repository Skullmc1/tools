import { expect, test } from "bun:test";
import { checkDependencies, isSatisfied, requiredBinaries } from "../src/cli/deps.ts";
import { manifests } from "../src/tools/manifests.ts";

test("requiredBinaries is the union of every tool's needs", () => {
  const binaries = requiredBinaries([
    { ...manifests[0]!, requires: ["ffmpeg", "ffprobe"] },
    { ...manifests[0]!, requires: ["ffmpeg", "gs"] },
  ]);
  expect(binaries).toEqual(["ffmpeg", "ffprobe", "gs"]);
});

test("reports what is missing", () => {
  const check = checkDependencies({
    packages: ["react", "sharp"],
    binaries: ["ffmpeg", "ffprobe"],
    hasPackage: (name) => name === "react",
    which: (binary) => (binary === "ffmpeg" ? "C:\\bin\\ffmpeg.exe" : null),
  });
  expect(check).toEqual({ missingPackages: ["sharp"], missingBinaries: ["ffprobe"] });
  expect(isSatisfied(check)).toBe(false);
});

test("is satisfied when everything is present", () => {
  const check = checkDependencies({
    packages: ["react"],
    binaries: ["ffmpeg"],
    hasPackage: () => true,
    which: () => "found",
  });
  expect(isSatisfied(check)).toBe(true);
});
