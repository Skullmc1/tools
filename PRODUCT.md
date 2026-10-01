# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun + TypeScript server, React + Tailwind CSS v4 front end bundled by Bun's own bundler (no Vite, no build step). Chosen by the user.

## Users

The owner, a developer on Windows, mid-task with a terminal open, who needs a file converted right now (a screen recording into a GIF for a README, PR or chat). The project is also shared on GitHub so other developers can clone and run it.

## Product Purpose

Typing `tools` in any terminal opens a local toolbox in the browser. Each tool converts or shrinks files on the user's own machine. Success is: from command to saved file in under a minute, with no upload to anyone else's server and no hunting for an online converter.

## Positioning

It is the user's own machine doing the work: files go in by drag-drop, come out through a real Save dialog, and nothing leaves the computer. One command starts it; it shuts itself down when the tab closes.

## Operating Context

- Launched from a terminal with `tools`; runs as a background server on 127.0.0.1 and exits when idle.
- Used in short bursts, many times a week, next to an editor and terminal.
- Must work offline: no CDN fonts, scripts or images.
- Depends on ffmpeg/ffprobe on PATH; `tools` installs missing dependencies itself.

## Capabilities and Constraints

- Live: Video to GIF (trim start/end, FPS, width, quality, size estimate, optional "keep under N MB").
- Live: Remove background (one image in, transparent PNG out at full resolution; no settings). Uses a local AI model, BiRefNet-lite (MIT), downloaded once on first use (109 MB) and kept in `~/.tools/models`; slower on a CPU, roughly 5 to 10 seconds per image.
- Planned, not built: PDF to images, images to PDF, image conversion, file compression.
- One file at a time. No crop, no speed change, no batch in v1.
- The save location is asked every time through the native Save dialog, after the result is shown.
- Windows only in v1.
- Each tool is a self-contained folder (manifest, server routes, UI) so new tools slot in.

## Brand Commitments

- Name: `tools` (lowercase, the command itself).
- The user asked for a bold and distinctive look.

## Evidence on Hand

- No logo, imagery or brand assets exist.
- Real content: the tool list above and the converter's real controls and output numbers. No testimonials, metrics or claims; none may be invented.

## Product Principles

1. The task comes first: drop, adjust, convert, save. Nothing sits between the user and that path.
2. Show the real result before saving: actual GIF, actual size.
3. Local and self-contained: works offline, cleans up after itself.
4. Tools are siblings: a new one should feel like it was always there.
