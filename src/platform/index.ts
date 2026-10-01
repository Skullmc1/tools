// Everything that differs between operating systems lives behind this
// interface. Only Windows is implemented so far.

export type SaveDialogOptions = {
  suggestedName: string;
  initialDir?: string;
  /** e.g. { label: "GIF image", ext: "gif" } */
  fileType: { label: string; ext: string };
};

export type SystemPackage = { id: string; label: string };

export interface Platform {
  openBrowser(url: string): void;
  /** Resolves to the chosen path, or null if the dialog was cancelled. */
  saveDialog(options: SaveDialogOptions): Promise<string | null>;
  revealInFileManager(path: string): void;
  /** The installable package that provides a program, if we know one. */
  packageFor(binary: string): SystemPackage | null;
  installCommand(pkg: SystemPackage): string;
  installPackage(pkg: SystemPackage): Promise<boolean>;
  /** PATH as a freshly opened terminal would see it. */
  freshPath(): Promise<string | null>;
}

export class UnsupportedPlatformError extends Error {
  constructor() {
    super(`tools does not support ${process.platform} yet (Windows only for now).`);
  }
}

export async function getPlatform(): Promise<Platform> {
  if (process.platform === "win32") return (await import("./windows.ts")).windows;
  throw new UnsupportedPlatformError();
}
