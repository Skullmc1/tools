import { spawn } from "node:child_process";
import type { Platform, SaveDialogOptions, SystemPackage } from "./index.ts";

const PACKAGES: Record<string, SystemPackage> = {
  ffmpeg: { id: "Gyan.FFmpeg", label: "FFmpeg" },
  ffprobe: { id: "Gyan.FFmpeg", label: "FFmpeg" },
};

// Values reach the script through environment variables, never by string
// interpolation, so a file name can't inject PowerShell.
const SAVE_DIALOG_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Save as'
$dialog.Filter = $env:TOOLS_DLG_FILTER
$dialog.DefaultExt = $env:TOOLS_DLG_EXT
$dialog.AddExtension = $true
$dialog.OverwritePrompt = $true
$dialog.FileName = $env:TOOLS_DLG_NAME
if ($env:TOOLS_DLG_DIR -and (Test-Path -LiteralPath $env:TOOLS_DLG_DIR)) { $dialog.InitialDirectory = $env:TOOLS_DLG_DIR }
$result = $dialog.ShowDialog($owner)
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::Out.Write($dialog.FileName)
}
`;

function powershell(script: string, env: Record<string, string> = {}) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return Bun.spawn(
    ["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
}

export const windows: Platform = {
  openBrowser(url) {
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  },

  async saveDialog({ suggestedName, initialDir, fileType }: SaveDialogOptions) {
    const proc = powershell(SAVE_DIALOG_SCRIPT, {
      TOOLS_DLG_NAME: suggestedName,
      TOOLS_DLG_DIR: initialDir ?? "",
      TOOLS_DLG_FILTER: `${fileType.label} (*.${fileType.ext})|*.${fileType.ext}`,
      TOOLS_DLG_EXT: fileType.ext,
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`Could not open the Save dialog: ${err.trim() || `exit code ${code}`}`);
    return out.trim() || null;
  },

  revealInFileManager(path) {
    // explorer needs the path quoted on its own, after the comma.
    spawn("explorer.exe", [`/select,"${path}"`], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    }).unref();
  },

  packageFor(binary) {
    return PACKAGES[binary] ?? null;
  },

  installCommand(pkg) {
    return `winget install --id ${pkg.id} -e`;
  },

  async installPackage(pkg) {
    const proc = Bun.spawn(
      ["winget", "install", "--id", pkg.id, "-e", "--accept-source-agreements", "--accept-package-agreements"],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    return (await proc.exited) === 0;
  },

  async freshPath() {
    const proc = powershell(
      `[Console]::Out.Write([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))`,
    );
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 && out.trim() ? out.trim() : null;
  },
};
