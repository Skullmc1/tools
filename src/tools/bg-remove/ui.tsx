import { useEffect, useRef, useState } from "react";
import { api, formatBytes, type JobEvent, uploadFile, watchJob } from "../../web/api.ts";
import { DropZone, hasAcceptedExtension } from "../../web/components/DropZone.tsx";
import { Alert } from "../../web/components/icons.tsx";
import { PrintProgress } from "../../web/components/PrintProgress.tsx";
import { SaveBox, useSaveFlow } from "../../web/components/SaveBox.tsx";
import { Segmented } from "../../web/components/Segmented.tsx";
import { takeHandedOffFile } from "../../web/router.tsx";
import type { ToolManifest } from "../manifests.ts";

type Source = { file: File; url: string; uploadId: string | null; size: { width: number; height: number } | null; uploaded: number };
type Result = Extract<JobEvent, { type: "done" }>["result"];
type Meta = { width: number; height: number; seconds: number };
type Status = { downloaded: boolean; modelMB: number };

type Run =
  | { phase: "idle" }
  | { phase: "running"; jobId: string; progress: number; note?: string; indeterminate?: boolean }
  | { phase: "done"; jobId: string; result: Result }
  | { phase: "error"; message: string };

type View = "result" | "original";
type Backdrop = "checker" | "white" | "black" | "orange";

const BACKDROPS: Record<Backdrop, string> = {
  checker: "checker",
  white: "bg-stock",
  black: "bg-ink",
  orange: "bg-signal",
};

export function BgRemoveTool({ manifest }: { manifest: ToolManifest }) {
  const [source, setSource] = useState<Source | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<View>("result");
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [originalFailed, setOriginalFailed] = useState(false);
  const saveFlow = useSaveFlow();

  // What must be cleaned up when the image changes or the page closes.
  const live = useRef<{ url?: string; uploadId?: string; jobId?: string; abortUpload?: () => void; stopWatching?: () => void }>({});

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
    setView("result");
    setOriginalFailed(false);
    saveFlow.clearError();
    void refreshStatus();
  }

  async function refreshStatus() {
    try {
      const res = await fetch("/api/bg-remove/status");
      if (res.ok) setStatus(await res.json());
    } catch {}
  }

  function removeBackground(uploadId: string) {
    const held = live.current;
    held.stopWatching?.();
    if (held.jobId) api.discard(`/api/jobs/${held.jobId}`);
    held.jobId = undefined;
    saveFlow.clearError();
    setView("result");
    setRun({ phase: "running", jobId: "", progress: 0, note: "Starting" });
    api
      .post<{ jobId: string }>("/api/bg-remove/convert", { uploadId })
      .then(({ jobId }) => {
        if (live.current !== held) return api.discard(`/api/jobs/${jobId}`);
        held.jobId = jobId;
        held.stopWatching = watchJob(jobId, (event) => {
          if (event.type === "progress") {
            setRun({ phase: "running", jobId, progress: event.progress, note: event.note, indeterminate: event.indeterminate });
          } else if (event.type === "done") setRun({ phase: "done", jobId, result: event.result });
          else if (event.type === "cancelled") setRun({ phase: "idle" });
          else setRun({ phase: "error", message: event.message });
        });
      })
      .catch((error) => {
        if (live.current === held) setRun({ phase: "error", message: error instanceof Error ? error.message : "Could not start." });
      });
  }

  async function loadFile(file: File) {
    if (!hasAcceptedExtension(file, manifest.accepts)) {
      setDropError(`${file.name} is not an image this tool can read. Try ${manifest.accepts.join(", ")}.`);
      return;
    }
    release();
    setRun({ phase: "idle" });
    setDropError(null);
    setOriginalFailed(false);
    const url = URL.createObjectURL(file);
    const upload = uploadFile(file, (uploaded) => setSource((s) => (s?.url === url ? { ...s, uploaded } : s)));
    const held = (live.current = { url, abortUpload: upload.abort } as typeof live.current);
    setSource({ file, url, uploadId: null, size: null, uploaded: 0 });
    try {
      const { uploadId } = await upload.promise;
      if (live.current !== held) return api.discard(`/api/uploads/${uploadId}`);
      held.uploadId = uploadId;
      const size = await api.post<{ width: number; height: number }>("/api/bg-remove/probe", { uploadId });
      if (live.current !== held) return;
      setSource((s) => (s?.url === url ? { ...s, uploadId, size, uploaded: 1 } : s));
      removeBackground(uploadId);
    } catch (error) {
      if (live.current !== held) return;
      startOver();
      setDropError(error instanceof Error ? error.message : "That file could not be loaded.");
    }
  }

  useEffect(() => {
    void refreshStatus();
    const handedOff = takeHandedOffFile();
    if (handedOff) void loadFile(handedOff);
    return release;
  }, []);

  if (!source) {
    const note = status
      ? status.downloaded
        ? "The model is on this computer, so this works offline."
        : `The first image downloads the AI model (${status.modelMB} MB), once. After that it works offline.`
      : null;
    return <DropZone title="Drop an image here" accepts={manifest.accepts} error={dropError} note={note} onFile={loadFile} />;
  }

  const done = run.phase === "done" ? run : null;
  const showing = view === "result" && done ? "result" : "original";

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
              {source.size
                ? `${source.size.width} × ${source.size.height}  ·  ${formatBytes(source.file.size)}`
                : `Reading the image… ${Math.round(source.uploaded * 100)}%`}
            </p>
          </div>
          <button type="button" className="btn" onClick={startOver}>
            Change image
          </button>
        </div>

        <div className={`${BACKDROPS[backdrop]} grid min-h-72 place-items-center p-4`}>
          {showing === "result" && done ? (
            <img
              key={done.jobId}
              src={`/api/jobs/${done.jobId}/result`}
              alt="The image with its background removed"
              className="ink-in max-h-[70vh] max-w-full"
            />
          ) : originalFailed ? (
            <p className="max-w-[40ch] bg-stock p-6 text-center">
              This browser can't show a preview of this file type. The result will still be a PNG.
            </p>
          ) : (
            <img
              src={source.url}
              alt="The original image"
              className="max-h-[70vh] max-w-full"
              onError={() => setOriginalFailed(true)}
            />
          )}
        </div>
      </section>

      <section className="label lg:col-span-4" aria-label="Result">
        {run.phase === "idle" && !source.size && (
          <div className="box">
            <span className="legend">Status</span>
            <p className="mt-1">Reading the image…</p>
          </div>
        )}

        {run.phase === "running" && (
          <PrintProgress
            title="Cutting out"
            progress={run.progress}
            indeterminate={run.indeterminate}
            note={run.note}
            cancelDisabled={!run.jobId}
            onCancel={() => void api.post(`/api/jobs/${run.jobId}/cancel`)}
          />
        )}

        {run.phase === "error" && (
          <div className="box grid gap-4" role="alert">
            <div className="flex min-w-0 gap-3">
              <Alert className="mt-1 shrink-0 text-signal-ink" />
              <div className="min-w-0">
                <p className="text-lg font-bold">The background could not be removed</p>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-soft">{run.message}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={!source.uploadId} onClick={() => removeBackground(source.uploadId!)}>
                Try again
              </button>
              <button type="button" className="btn" onClick={startOver}>
                Choose another image
              </button>
            </div>
          </div>
        )}

        {done && <ResultPanel done={done} view={view} setView={setView} backdrop={backdrop} setBackdrop={setBackdrop} saveFlow={saveFlow} />}
      </section>
    </div>
  );
}

type PanelProps = {
  done: Extract<Run, { phase: "done" }>;
  view: View;
  setView: (view: View) => void;
  backdrop: Backdrop;
  setBackdrop: (backdrop: Backdrop) => void;
  saveFlow: ReturnType<typeof useSaveFlow>;
};

function ResultPanel({ done, view, setView, backdrop, setBackdrop, saveFlow }: PanelProps) {
  const meta = done.result.meta as Meta;
  return (
    <div className="ink-in grid gap-[2px]">
      <div className="box">
        <span className="legend">Size</span>
        <p className="value mt-1 text-5xl">{formatBytes(done.result.size)}</p>
      </div>
      <div className="grid grid-cols-2 gap-[2px]">
        <div className="box">
          <span className="legend">Dimensions</span>
          <p className="value mt-1 whitespace-nowrap">
            {meta.width} × {meta.height}
          </p>
        </div>
        <div className="box">
          <span className="legend">Took</span>
          <p className="value mt-1">{meta.seconds.toFixed(1)} s</p>
        </div>
      </div>
      <div className="box">
        <span className="legend">Show</span>
        <div className="mt-2">
          <Segmented
            name="Show"
            options={[
              { value: "result", label: "Result" },
              { value: "original", label: "Original" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>
      <div className="box">
        <span className="legend">Behind it</span>
        <div className="mt-2">
          <Segmented
            name="Backdrop"
            options={[
              { value: "checker", label: "Clear" },
              { value: "white", label: "White" },
              { value: "black", label: "Black" },
              { value: "orange", label: "Orange" },
            ]}
            value={backdrop}
            onChange={setBackdrop}
          />
        </div>
        <p className="mt-2 text-sm text-ink-soft">For judging the edges. The saved file is always transparent.</p>
      </div>
      <SaveBox jobId={done.jobId} flow={saveFlow} />
    </div>
  );
}
