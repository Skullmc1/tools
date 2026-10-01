# tools

A local toolbox that opens in your browser when you type `tools` in any terminal. Files are converted on your own machine; nothing is uploaded anywhere.

**Tools so far**

- **Video to GIF**: trim, frame rate, width, quality, a size estimate, and an optional "keep under N MB" limit.

Planned: PDF to images, images to PDF, image conversion, file compression.

Windows only for now.

## Install

You need [Bun](https://bun.sh) 1.3 or newer.

```bash
git clone <this repo> tools
cd tools
bun install
bun link
```

`bun link` puts a `tools` command in `~/.bun/bin`, which Bun adds to your PATH.

## Use

```bash
tools
```

- The first run checks for what the tools need (currently FFmpeg). If something is missing it offers to install it with `winget`.
- A small server starts in the background on `http://127.0.0.1:4777` and your browser opens. Your terminal is free straight away.
- Running `tools` again reuses the running server.
- The server stops by itself five minutes after the last tab closes. `tools --stop` stops it now (do this after `git pull` to pick up new code).

In a tool: drop a file, adjust the settings, convert, look at the real result, then **Save as…** to choose where it goes.

## Where things live

| Path | What |
|---|---|
| `~/.tools/server.json` | The running server's pid and port |
| `~/.tools/config.json` | The last folder you saved to |
| `~/.tools/server.log` | Server log |
| `%TEMP%\tools-app\` | Uploads and results, deleted when the server stops |

## Develop

```bash
bun run dev        # server with hot reload at http://127.0.0.1:4777
bun test           # unit tests plus real ffmpeg conversions
bun run typecheck
```

### Layout

```
src/
  cli/        the `tools` command: dependency setup, start or reuse the server, open the browser
  platform/   everything OS-specific (browser, Save dialog, installer). Only windows.ts exists
  server/     Bun.serve, uploads, jobs with progress, saving, idle shutdown
  tools/      one folder per tool, plus the registries
  web/        React app shell, home page, shared components, styles
```

### Adding a tool

1. Add its entry to `src/tools/manifests.ts` (or flip a planned one to `status: "live"`). List any programs it needs in `requires`, and teach `src/platform/windows.ts` which package provides them.
2. Create `src/tools/<id>/server.ts` exporting a `ToolServer`: routes under `/api/<id>/`. Use `ctx.workspace` for uploads and temp files and `ctx.jobs.start(...)` for long work; progress, cancelling, previewing and saving the result then work without more code.
3. Create `src/tools/<id>/ui.tsx` exporting the screen component.
4. Register them in `src/tools/registry.server.ts` and `src/tools/registry.client.tsx`.

The visual system is described in [DESIGN.md](DESIGN.md); new screens should use its components as they are.

## Security notes

The server listens on 127.0.0.1 only and rejects API requests whose `Host` or `Origin` is not its own, so other websites cannot drive it. The save location always comes from the native Save dialog, never from a request.
