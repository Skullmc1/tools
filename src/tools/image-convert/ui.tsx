import { useEffect, useRef, useState } from "react";
import type { ImageInfo } from "../../server/image.ts";
import { api, formatBytes, type JobEvent, uploadFile, watchJob } from "../../web/api.ts";
import { DropZone, hasAcceptedExtension } from "../../web/components/DropZone.tsx";
import { Alert } from "../../web/components/icons.tsx";
import { NumberField } from "../../web/components/NumberField.tsx";
import { PrintProgress } from "../../web/components/PrintProgress.tsx";
import { SaveBox, useSaveFlow } from "../../web/components/SaveBox.tsx";
import { Segmented } from "../../web/components/Segmented.tsx";
import { takeHandedOffFile } from "../../web/router.tsx";
import type { ToolManifest } from "../manifests.ts";
import type { Background, Format } from "./convert.ts";

type Settings = { format: Format; quality: number; /** 0 means the original width. */ width: number; background: Background };
type Source = { file: File; url: string; uploadId: string | null; info: ImageInfo | null; uploaded: number };
type Result = Extract<JobEvent, { type: "done" }>["result"];
type Meta = { width: number; height: number; format: Format; quality: number };
type Latest = { jobId: string; result: Result; key: string };
type View = "result" | "original";

const STORAGE_KEY = "tools.image-convert.settings";
const DEFAULTS: Settings = { format: "webp", quality: 80, width: 0, background: "white" };
const WIDTH_PRESETS = [1920, 1280, 800, 480];
const DEBOUNCE_MS = 450;

const FORMAT_NOTES: Record<Format, string> = {
  png: "Lossless, and keeps transparency. Large for photos.",
  jpeg: "Small photos that open anywhere. No transparency.",
  webp: "Small, keeps transparency, opens in every modern browser.",
  avif: "The smallest files, but slower to make, and not every app opens it yet.",
};

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function ImageConvertTool({ manifest }: { manifest: ToolManifest }) {
  const [source, setSource] = useState<Source | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("result");
  const [originalFailed, setOriginalFailed] = useState(false);
  const saveFlow = useSaveFlow();

  const run = useRef(0);
  // What must be cleaned up when the image changes or the page closes.
  const live = useRef<{ url?: string; uploadId?: string; pendingJob?: string; shownJob?: string; abortUpload?: () => void; stopWatching?: () => void }>({});

  const info = source?.info ?? null;
  const ready = Boolean(source?.uploadId && info);
  const width = info ? (settings.width > 0 ? Math.min(settings.width, info.width) : info.width) : 0;
  const request = { format: settings.format, quality: settings.quality, width, background: settings.background };
  const key = JSON.stringify(request);
  const lossy = settings.format !== "png";
  const flattens = settings.format === "jpeg" && Boolean(info?.hasAlpha);

  const update = (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch }));

  function release() {
    run.current++;
    const held = live.current;
    live.current = {};
    held.abortUpload?.();
    held.stopWatching?.();
    if (held.pendingJob) api.discard(`/api/jobs/${held.pendingJob}`);
    if (held.shownJob) api.discard(`/api/jobs/${held.shownJob}`);
    if (held.uploadId) api.discard(`/api/uploads/${held.uploadId}`);
    if (held.url) URL.revokeObjectURL(held.url);
  }

  function startOver() {
    release();
    setSource(null);
    setLatest(null);
    setBusy(false);
    setError(null);
    setView("result");
    setOriginalFailed(false);
    saveFlow.clearError();
  }

  /** Converts with the given settings, replacing any conversion still running. */
  function convert(uploadId: string, body: typeof request, bodyKey: string) {
    const mine = ++run.current;
    const held = live.current;
    held.stopWatching?.();
    if (held.pendingJob) api.discard(`/api/jobs/${held.pendingJob}`);
    held.pendingJob = undefined;
    setBusy(true);
    setError(null);
    saveFlow.clearError();

    api
      .post<{ jobId: string }>("/api/image-convert/convert", { uploadId, settings: body })
      .then(({ jobId }) => {
        if (run.current !== mine) return api.discard(`/api/jobs/${jobId}`);
        held.pendingJob = jobId;
        held.stopWatching = watchJob(jobId, (event) => {
          if (run.current !== mine) return;
          if (event.type === "done") {
            const previous = held.shownJob;
            held.shownJob = jobId;
            held.pendingJob = undefined;
            setLatest({ jobId, result: event.result, key: bodyKey });
            setBusy(false);
            if (previous) api.discard(`/api/jobs/${previous}`);
          } else if (event.type === "error") {
            setError(event.message);
            setBusy(false);
          } else if (event.type === "cancelled") setBusy(false);
        });
      })
      .catch((caught) => {
        if (run.current !== mine) return;
        setError(caught instanceof Error ? caught.message : "The conversion could not start.");
        setBusy(false);
      });
  }

  async function loadFile(file: File) {
    if (!hasAcceptedExtension(file, manifest.accepts)) {
      setDropError(`${file.name} is not an image this tool can read. Try ${manifest.accepts.join(", ")}.`);
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
      const probed = await api.post<ImageInfo>("/api/image-convert/probe", { uploadId });
      if (live.current !== held) return;
      setSource((s) => (s?.url === url ? { ...s, uploadId, info: probed, uploaded: 1 } : s));
    } catch (caught) {
      if (live.current !== held) return;
      startOver();
      setDropError(caught instanceof Error ? caught.message : "That file could not be loaded.");
    }
  }

  useEffect(() => {
    const handedOff = takeHandedOffFile();
    if (handedOff) void loadFile(handedOff);
    return release;
  }, []);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), [settings]);

  // Convert once the image is ready, and again shortly after settings stop changing.
  useEffect(() => {
    if (!ready) return;
    const first = live.current.shownJob === undefined && live.current.pendingJob === undefined;
    const timer = setTimeout(() => convert(source!.uploadId!, request, key), first ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ready, key]);

  if (!source) {
    return <DropZone title="Drop an image here" accepts={manifest.accepts} error={dropError} onFile={loadFile} />;
  }

  const widthOptions = [
    { value: 0, label: "Original" },
    ...WIDTH_PRESETS.filter((w) => !info || w < info.width).map((w) => ({ value: w, label: String(w) })),
  ];
  const showing = view === "result" && latest ? "result" : "original";
  const fresh = latest?.key === key && !busy;

  return (
    <div className="grid items-start gap-3 lg:grid-cols-12">
      <section className="label lg:col-span-8" aria-label="Image">
        <div className="box flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <span className="legend">Contents</span>
            <p className="truncate text-lg font-bold" title={source.file.name}>
              {source.file.name}
            </p>
            <p className="value text-sm text-ink-soft">
              {info
                ? `${info.width} × ${info.height}  ·  ${formatBytes(source.file.size)}`
                : `Reading the image… ${Math.round(source.uploaded * 100)}%`}
            </p>
          </div>
          <button type="button" className="btn" onClick={startOver}>
            Change image
          </button>
        </div>

        <div className="checker grid min-h-72 place-items-center p-4">
          {showing === "result" && latest ? (
            <img
              key={latest.jobId}
              src={`/api/jobs/${latest.jobId}/result`}
              alt="The converted image"
              className="max-h-[70vh] max-w-full"
            />
          ) : originalFailed ? (
            <p className="max-w-[40ch] bg-stock p-6 text-center">
              This browser can't show a preview of this file type. The converted file will still work.
            </p>
          ) : (
            <img src={source.url} alt="The original image" className="max-h-[70vh] max-w-full" onError={() => setOriginalFailed(true)} />
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:col-span-4">
        <section className="label" aria-label="Settings">
          <div className="box">
            <span className="legend">Format</span>
            <div className="mt-2">
              <Segmented
                name="Format"
                options={[
                  { value: "png", label: "PNG" },
                  { value: "jpeg", label: "JPEG" },
                  { value: "webp", label: "WebP" },
                  { value: "avif", label: "AVIF" },
                ]}
                value={settings.format}
                disabled={!ready}
                onChange={(format) => update({ format })}
              />
            </div>
            <p className="mt-2 text-sm text-ink-soft">{FORMAT_NOTES[settings.format]}</p>
          </div>

          <div className="box">
            <div className="flex items-baseline justify-between">
              <label className="legend" htmlFor="image-quality">
                Quality
              </label>
              <span className="value">{lossy ? settings.quality : "Lossless"}</span>
            </div>
            <input
              id="image-quality"
              type="range"
              className="range mt-2"
              min={1}
              max={100}
              step={1}
              value={settings.quality}
              disabled={!ready || !lossy}
              onChange={(event) => update({ quality: Number(event.target.value) })}
            />
            <p className="mt-1 text-sm text-ink-soft">
              {lossy ? "Lower means a smaller file with more visible artefacts." : "PNG always keeps every pixel, so there is nothing to set."}
            </p>
          </div>

          <div className="box">
            <div className="flex items-baseline justify-between">
              <span className="legend">Width</span>
              <span className="value">
                {info ? `${width} × ${Math.max(1, Math.round((width * info.height) / info.width))} px` : ""}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_6.5rem] gap-2">
              <Segmented
                name="Width preset"
                options={widthOptions}
                value={settings.width > 0 && info && settings.width < info.width ? settings.width : 0}
                disabled={!ready}
                onChange={(w) => update({ width: w })}
              />
              <NumberField
                value={width}
                min={1}
                max={info?.width ?? 1}
                step={10}
                disabled={!ready}
                aria-label="Custom width in pixels"
                onCommit={(w) => update({ width: info && w >= info.width ? 0 : Math.round(w) })}
              />
            </div>
          </div>

          {flattens && (
            <div className="box">
              <span className="legend">Fill transparent areas with</span>
              <div className="mt-2">
                <Segmented
                  name="Background"
                  options={[
                    { value: "white", label: "White" },
                    { value: "black", label: "Black" },
                  ]}
                  value={settings.background}
                  onChange={(background) => update({ background })}
                />
              </div>
              <p className="mt-2 text-sm text-ink-soft">JPEG cannot be see-through.</p>
            </div>
          )}
        </section>

        <section className="label" aria-label="Result">
          {error && (
            <div className="box grid gap-3" role="alert">
              <div className="flex min-w-0 gap-3">
                <Alert className="mt-1 shrink-0 text-signal-ink" />
                <div className="min-w-0">
                  <p className="text-lg font-bold">The image could not be converted</p>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-soft">{error}</p>
                </div>
              </div>
              <div>
                <button type="button" className="btn" disabled={!ready} onClick={() => convert(source.uploadId!, request, key)}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {!latest && !error && <PrintProgress title="Converting" progress={0} indeterminate note="Making your file" />}

          {latest && (
            <ResultPanel
              latest={latest}
              originalBytes={source.file.size}
              updating={busy}
              fresh={fresh}
              view={view}
              setView={setView}
              saveFlow={saveFlow}
            />
          )}
        </section>
      </div>
    </div>
  );
}

type PanelProps = {
  latest: Latest;
  originalBytes: number;
  updating: boolean;
  fresh: boolean;
  view: View;
  setView: (view: View) => void;
  saveFlow: ReturnType<typeof useSaveFlow>;
};

function ResultPanel({ latest, originalBytes, updating, fresh, view, setView, saveFlow }: PanelProps) {
  const meta = latest.result.meta as Meta;
  const size = latest.result.size;
  const change = Math.round((1 - size / originalBytes) * 100);
  return (
    <div className="ink-in grid gap-[2px]" aria-busy={updating}>
      <div className="box">
        <div className="flex items-baseline justify-between gap-2">
          <span className="legend">Size</span>
          {updating && <span className="legend text-ink-soft">Updating…</span>}
        </div>
        <p className="value mt-1 text-5xl">{formatBytes(size)}</p>
      </div>
      <div className="grid grid-cols-2 gap-[2px]">
        <div className="box">
          <span className="legend">Original</span>
          <p className="value mt-1">{formatBytes(originalBytes)}</p>
        </div>
        <div className="box">
          <span className="legend">Change</span>
          <p className="value mt-1 whitespace-nowrap">{change === 0 ? "same" : change > 0 ? `${change}% smaller` : `${-change}% larger`}</p>
        </div>
      </div>
      <div className="box">
        <span className="legend">Dimensions</span>
        <p className="value mt-1 whitespace-nowrap">
          {meta.width} × {meta.height}
        </p>
      </div>
      <div className="box">
        <span className="legend">Show</span>
        <div className="mt-2">
          <Segmented
            name="Show"
            options={[
              { value: "result", label: "Converted" },
              { value: "original", label: "Original" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
        <p className="mt-2 text-sm text-ink-soft">Camera and location details in the photo are removed.</p>
      </div>
      <SaveBox jobId={latest.jobId} flow={saveFlow} disabled={!fresh} />
    </div>
  );
}
