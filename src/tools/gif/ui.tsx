import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, formatBytes, formatSeconds, type JobEvent, uploadFile, watchJob } from "../../web/api.ts";
import { DropZone, hasAcceptedExtension } from "../../web/components/DropZone.tsx";
import { Alert, Check, Folder, Pause, Play, Save } from "../../web/components/icons.tsx";
import { NumberField } from "../../web/components/NumberField.tsx";
import { Segmented } from "../../web/components/Segmented.tsx";
import { TrimBar } from "../../web/components/TrimBar.tsx";
import { takeHandedOffFile } from "../../web/router.tsx";
import type { ToolManifest } from "../manifests.ts";
import type { Quality, VideoInfo } from "./ffmpeg.ts";

type Settings = { fps: number; width: number; quality: Quality; keepUnder: boolean; targetMB: number };
type Range = { start: number; end: number };
type Source = { file: File; url: string; uploadId: string | null; info: VideoInfo | null; uploaded: number };
type Result = Extract<JobEvent, { type: "done" }>["result"];
type Meta = { width: number; height: number; fps: number; duration: number; attempts: number; targetBytes: number | null; hitTarget: boolean };

type Run =
  | { phase: "idle" }
  | { phase: "running"; jobId: string; progress: number; note?: string }
  | { phase: "done"; jobId: string; result: Result; requestKey: string; savedPath?: string }
  | { phase: "error"; message: string };

const STORAGE_KEY = "tools.gif.settings";
const DEFAULTS: Settings = { fps: 15, width: 480, quality: "medium", keepUnder: false, targetMB: 5 };
const WIDTH_PRESETS = [320, 480, 640];
const MAX_FPS = 30;

const QUALITY_NOTES: Record<Quality, string> = {
  low: "64 colours. Smallest file.",
  medium: "128 colours. A good default.",
  high: "256 colours with smoother gradients. Largest file.",
};

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

const maxFpsFor = (info: VideoInfo | null) => (info ? Math.max(1, Math.min(MAX_FPS, Math.round(info.fps))) : MAX_FPS);

export function GifTool({ manifest }: { manifest: ToolManifest }) {
  const [source, setSource] = useState<Source | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [settings, setSettings] = useState(loadSettings);
  const [estimate, setEstimate] = useState<number | "pending" | null>(null);
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  // What must be cleaned up when the file changes or the page closes.
  const live = useRef<{ url?: string; uploadId?: string; jobId?: string; abortUpload?: () => void; stopWatching?: () => void }>({});

  const info = source?.info ?? null;
  const ready = Boolean(source?.uploadId && info);
  const maxFps = maxFpsFor(info);
  const fps = Math.min(settings.fps, maxFps);
  const width = info ? Math.min(settings.width, info.width) : settings.width;
  const height = info ? Math.max(1, Math.round((width * info.height) / info.width)) : null;
  const request = { settings: { ...range, fps, width, quality: settings.quality }, targetMB: settings.keepUnder ? settings.targetMB : undefined };
  const requestKey = JSON.stringify(request);

  const update = (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch }));

  function release() {
    const held = live.current;
    live.current = {};
    held.abortUpload?.();
    held.stopWatching?.();
    if (held.jobId) api.discard(`/api/jobs/${held.jobId}`);
    if (held.uploadId) api.discard(`/api/uploads/${held.uploadId}`);
    if (held.url) URL.revokeObjectURL(held.url);
  }

  function startOver() {
    release();
    setSource(null);
    setRun({ phase: "idle" });
    setEstimate(null);
    setSaveError(null);
    setPlaying(false);
    setPreviewFailed(false);
  }

  async function loadFile(file: File) {
    if (!hasAcceptedExtension(file, manifest.accepts)) {
      setDropError(`${file.name} is not a video this tool can read. Try ${manifest.accepts.join(", ")}.`);
      return;
    }
    startOver();
    setDropError(null);
    const url = URL.createObjectURL(file);
    const upload = uploadFile(file, (uploaded) => setSource((s) => (s?.url === url ? { ...s, uploaded } : s)));
    const held = (live.current = { url, abortUpload: upload.abort } as typeof live.current);
    setSource({ file, url, uploadId: null, info: null, uploaded: 0 });
    try {
      const { uploadId } = await upload.promise;
      if (live.current !== held) return api.discard(`/api/uploads/${uploadId}`);
      held.uploadId = uploadId;
      const probed = await api.post<VideoInfo>("/api/gif/probe", { uploadId });
      if (live.current !== held) return;
      setSource((s) => (s?.url === url ? { ...s, uploadId, info: probed, uploaded: 1 } : s));
      setRange({ start: 0, end: probed.duration });
    } catch (error) {
      if (live.current !== held) return;
      startOver();
      setDropError(error instanceof Error ? error.message : "That file could not be loaded.");
    }
  }

  useEffect(() => {
    const handedOff = takeHandedOffFile();
    if (handedOff) void loadFile(handedOff);
    return release;
  }, []);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), [settings]);

  // Re-estimate the output size shortly after the settings stop changing.
  const estimateKey = JSON.stringify(request.settings);
  useEffect(() => {
    if (!ready || run.phase === "running") return;
    setEstimate("pending");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const body = { uploadId: source!.uploadId, settings: request.settings };
        const reply = await api.post<{ bytes?: number }>("/api/gif/estimate", body, controller.signal);
        if (reply.bytes !== undefined) setEstimate(reply.bytes);
      } catch {
        if (!controller.signal.aborted) setEstimate(null);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ready, estimateKey, run.phase === "running"]);

  // Keep the playhead moving smoothly and loop inside the selected range.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      const el = video.current;
      if (el) {
        if (el.currentTime >= range.end || el.currentTime < range.start) el.currentTime = range.start;
        setPlayhead(el.currentTime);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, range.start, range.end]);

  function seek(time: number) {
    setPlayhead(time);
    if (video.current) video.current.currentTime = time;
  }

  function changeRange(next: Range, moved: "start" | "end") {
    video.current?.pause();
    setRange(next);
    seek(moved === "start" ? next.start : next.end);
  }

  function togglePlay() {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPreviewFailed(true));
    else el.pause();
  }

  async function convert() {
    if (!ready) return;
    live.current.stopWatching?.();
    if (live.current.jobId) api.discard(`/api/jobs/${live.current.jobId}`);
    live.current.jobId = undefined;
    setSaveError(null);
    setRun({ phase: "running", jobId: "", progress: 0 });
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    try {
      const { jobId } = await api.post<{ jobId: string }>("/api/gif/convert", { uploadId: source!.uploadId, ...request });
      live.current.jobId = jobId;
      live.current.stopWatching = watchJob(jobId, (event) => {
        if (event.type === "progress") setRun({ phase: "running", jobId, progress: event.progress, note: event.note });
        else if (event.type === "done") setRun({ phase: "done", jobId, result: event.result, requestKey });
        else if (event.type === "cancelled") setRun({ phase: "idle" });
        else setRun({ phase: "error", message: event.message });
      });
    } catch (error) {
      setRun({ phase: "error", message: error instanceof Error ? error.message : "The conversion could not start." });
    }
  }

  async function save(jobId: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const outcome = await api.post<{ saved: boolean; path?: string }>(`/api/jobs/${jobId}/save`);
      if (outcome.saved) setRun((r) => (r.phase === "done" ? { ...r, savedPath: outcome.path } : r));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The file could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!source) {
    return <DropZone title="Drop a video here" accepts={manifest.accepts} error={dropError} onFile={loadFile} />;
  }

  const busy = run.phase === "running";
  const locked = !ready || busy;
  const widthOptions = [
    ...WIDTH_PRESETS.filter((w) => !info || w < info.width).map((w) => ({ value: w, label: String(w) })),
    ...(info ? [{ value: info.width, label: "Original" }] : []),
  ];
  const overTarget = settings.keepUnder && typeof estimate === "number" && estimate > settings.targetMB * 1024 * 1024;

  return (
    <div className="grid items-start gap-3 lg:grid-cols-12">
      <section className="label lg:col-span-7" aria-label="Source video">
        <div className="box flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <span className="legend">Contents</span>
            <p className="truncate text-lg font-bold" title={source.file.name}>
              {source.file.name}
            </p>
            <p className="value text-sm text-ink-soft">
              {info
                ? `${info.width} × ${info.height}  ·  ${Number(info.fps.toFixed(2))} fps  ·  ${formatSeconds(info.duration)}  ·  ${formatBytes(source.file.size)}`
                : `Reading the file… ${Math.round(source.uploaded * 100)}%`}
            </p>
          </div>
          <button type="button" className="btn" onClick={startOver}>
            Change file
          </button>
        </div>

        <div className="box-inverse grid min-h-48 place-items-center">
          {previewFailed ? (
            <p className="max-w-[40ch] p-8 text-center">
              This browser can't play the file, so there is no preview. Trimming by time still works.
            </p>
          ) : (
            <video
              ref={video}
              src={source.url}
              className="max-h-[55vh] w-full cursor-pointer object-contain"
              muted
              playsInline
              preload="auto"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setPreviewFailed(true)}
            />
          )}
        </div>

        <div className="box">
          <span className="legend">Trim</span>
          <div className="mt-3 flex items-start gap-3">
            <button
              type="button"
              className="btn w-12 shrink-0 px-0"
              onClick={togglePlay}
              disabled={previewFailed}
              aria-label={playing ? "Pause preview" : "Play selection"}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <div className="min-w-0 flex-1">
              {info ? (
                <TrimBar
                  duration={info.duration}
                  start={range.start}
                  end={range.end}
                  playhead={playhead}
                  disabled={locked}
                  onChange={changeRange}
                  onSeek={seek}
                />
              ) : (
                <div className="mx-2 h-12 border-2 border-blank" />
              )}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Labelled label="Start (s)">
              <NumberField
                value={Number(range.start.toFixed(1))}
                min={0}
                max={Math.max(0, range.end - 0.1)}
                step={0.1}
                disabled={locked}
                onCommit={(start) => changeRange({ ...range, start }, "start")}
              />
            </Labelled>
            <Labelled label="End (s)">
              <NumberField
                value={Number(range.end.toFixed(1))}
                min={range.start + 0.1}
                max={info?.duration ?? 0}
                step={0.1}
                disabled={locked}
                onCommit={(end) => changeRange({ ...range, end }, "end")}
              />
            </Labelled>
            <div>
              <span className="legend">Length</span>
              <p className="value mt-1 flex min-h-10 items-center text-lg">{formatSeconds(range.end - range.start)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="label lg:col-span-5" aria-label="GIF settings">
        <div className="box">
          <div className="flex items-baseline justify-between">
            <label className="legend" htmlFor="gif-fps">
              Frame rate
            </label>
            <span className="value">{fps} fps</span>
          </div>
          <input
            id="gif-fps"
            type="range"
            className="range mt-2"
            min={Math.min(5, maxFps)}
            max={maxFps}
            step={1}
            value={fps}
            disabled={locked}
            onChange={(event) => update({ fps: Number(event.target.value) })}
          />
        </div>

        <div className="box">
          <div className="flex items-baseline justify-between">
            <span className="legend">Width</span>
            <span className="value">{height ? `${width} × ${height} px` : `${width} px`}</span>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_6.5rem] gap-2">
            <Segmented name="Width preset" options={widthOptions} value={width} disabled={locked} onChange={(w) => update({ width: w })} />
            <NumberField
              value={width}
              min={16}
              max={info?.width ?? 4096}
              step={10}
              disabled={locked}
              aria-label="Custom width in pixels"
              onCommit={(w) => update({ width: Math.round(w) })}
            />
          </div>
        </div>

        <div className="box">
          <span className="legend">Quality</span>
          <div className="mt-2">
            <Segmented
              name="Quality"
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
              value={settings.quality}
              disabled={locked}
              onChange={(quality) => update({ quality })}
            />
          </div>
          <p className="mt-2 text-sm text-ink-soft">{QUALITY_NOTES[settings.quality]}</p>
        </div>

        <div className="box">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-ink"
                checked={settings.keepUnder}
                disabled={locked}
                onChange={(event) => update({ keepUnder: event.target.checked })}
              />
              Keep under
            </label>
            <div className="w-24">
              <NumberField
                value={settings.targetMB}
                min={0.1}
                max={500}
                step={0.5}
                disabled={locked || !settings.keepUnder}
                aria-label="Size limit in megabytes"
                onCommit={(targetMB) => update({ targetMB })}
              />
            </div>
            <span className="value">MB</span>
          </div>
          {overTarget && (
            <p className="mt-2 text-sm text-ink-soft">
              The estimate is over the limit. Width, then frame rate, will be lowered until it fits.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-[2px]">
          <div className="box">
            <span className="legend">Estimated size</span>
            <p className="value mt-1 text-2xl" aria-live="polite">
              {typeof estimate === "number" ? `≈ ${formatBytes(estimate)}` : estimate === "pending" ? "…" : "—"}
            </p>
          </div>
          <button
            type="button"
            className="code grid min-h-24 cursor-pointer place-items-center bg-signal text-4xl transition-colors duration-150 hover:bg-ink hover:text-stock focus-visible:outline-ink disabled:cursor-not-allowed disabled:bg-liner disabled:text-ink-soft"
            disabled={locked}
            onClick={convert}
          >
            {run.phase === "done" ? "Convert again" : "Convert"}
          </button>
        </div>
      </section>

      {run.phase !== "idle" && (
        <section ref={resultRef} className="label lg:col-span-12" aria-label="Result">
          {run.phase === "running" && (
            <>
              <div
                className="box relative min-h-40 overflow-hidden"
                role="progressbar"
                aria-label="Converting"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(run.progress * 100)}
              >
                <div className="print-fill absolute inset-0 bg-ink" style={{ scale: `${run.progress} 1` }} />
                <div className="relative flex min-h-32 flex-wrap items-end justify-between gap-4 text-stock mix-blend-difference">
                  <p className="code text-5xl sm:text-7xl">Converting</p>
                  <p className="value text-3xl">{Math.round(run.progress * 100)}%</p>
                </div>
              </div>
              <div className="box flex flex-wrap items-center justify-between gap-3">
                <p className="text-ink-soft">{run.note ?? "Building the palette and writing frames."}</p>
                <button
                  type="button"
                  className="btn"
                  disabled={!run.jobId}
                  onClick={() => void api.post(`/api/jobs/${run.jobId}/cancel`)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {run.phase === "error" && (
            <div className="box flex flex-wrap items-start justify-between gap-4" role="alert">
              <div className="flex min-w-0 gap-3">
                <Alert className="mt-1 shrink-0 text-signal-ink" />
                <div className="min-w-0">
                  <p className="text-lg font-bold">The conversion failed</p>
                  <p className="value mt-1 text-sm break-words whitespace-pre-wrap text-ink-soft">{run.message}</p>
                </div>
              </div>
              <button type="button" className="btn" onClick={convert}>
                Try again
              </button>
            </div>
          )}

          {run.phase === "done" && (
            <ResultLabel
              run={run}
              stale={run.requestKey !== requestKey}
              saving={saving}
              saveError={saveError}
              onSave={() => save(run.jobId)}
              onReveal={() => void api.post(`/api/jobs/${run.jobId}/reveal`).catch(() => {})}
            />
          )}
        </section>
      )}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="legend mb-1">{label}</span>
      {children}
    </label>
  );
}

function targetMessage(meta: Meta): string | null {
  if (!meta.targetBytes) return null;
  // In megabytes, the unit the limit was typed in.
  const limit = `${Number((meta.targetBytes / 1024 / 1024).toFixed(2))} MB`;
  if (!meta.hitTarget) return `Could not get under ${limit}. This is the smallest version, at ${meta.width} px and ${meta.fps} fps.`;
  if (meta.attempts > 1) return `Lowered to ${meta.width} px at ${meta.fps} fps to fit under ${limit}.`;
  return `Fits under ${limit} without changes.`;
}

type ResultProps = {
  run: Extract<Run, { phase: "done" }>;
  stale: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onReveal: () => void;
};

function ResultLabel({ run, stale, saving, saveError, onSave, onReveal }: ResultProps) {
  const meta = run.result.meta as Meta;
  const note = targetMessage(meta);
  return (
    <div className="ink-in grid gap-[2px] md:grid-cols-12">
      <div className="box-inverse grid place-items-center p-4 md:col-span-7">
        <img
          src={`/api/jobs/${run.jobId}/result`}
          alt={`Converted GIF, ${meta.width} by ${meta.height} pixels`}
          className="max-h-[32rem] max-w-full"
        />
      </div>
      <div className="grid content-start gap-[2px] md:col-span-5">
        <div className="box">
          <span className="legend">Size</span>
          <p className="value mt-1 text-5xl">{formatBytes(run.result.size)}</p>
        </div>
        <div className="grid gap-[2px] sm:grid-cols-3">
          <div className="box">
            <span className="legend">Dimensions</span>
            <p className="value mt-1 whitespace-nowrap">
              {meta.width} × {meta.height}
            </p>
          </div>
          <div className="box">
            <span className="legend">Frame rate</span>
            <p className="value mt-1">{meta.fps} fps</p>
          </div>
          <div className="box">
            <span className="legend">Length</span>
            <p className="value mt-1">{formatSeconds(meta.duration)}</p>
          </div>
        </div>
        {note && (
          <div className="box">
            <p>{note}</p>
          </div>
        )}
        {stale && (
          <div className="box">
            <p className="text-ink-soft">Settings have changed since this GIF was made. Convert again to apply them.</p>
          </div>
        )}
        <div className="box grid gap-3">
          <button type="button" className="btn btn-primary min-h-14 text-lg" disabled={saving} onClick={onSave}>
            <Save />
            {saving ? "Choose where to save…" : run.savedPath ? "Save another copy…" : "Save as…"}
          </button>
          {run.savedPath && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex min-w-0 items-start gap-2">
                <Check className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  Saved to <span className="value text-sm break-all">{run.savedPath}</span>
                </span>
              </p>
              <button type="button" className="btn" onClick={onReveal}>
                <Folder />
                Show in folder
              </button>
            </div>
          )}
          {saveError && (
            <p className="flex items-start gap-2 font-semibold" role="alert">
              <Alert className="mt-0.5 shrink-0 text-signal-ink" />
              {saveError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
