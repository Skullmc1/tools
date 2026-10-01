import { useState } from "react";
import { api } from "../api.ts";
import { Alert, Check, Folder, Save } from "./icons.tsx";

/** State for saving a finished job's result through the native Save dialog. */
export function useSaveFlow() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ jobId: string; path: string } | null>(null);

  return {
    saving,
    error,
    /** Where this job's result was saved, if it has been. */
    savedPathFor: (jobId: string) => (saved?.jobId === jobId ? saved.path : undefined),
    clearError: () => setError(null),
    async save(jobId: string) {
      setSaving(true);
      setError(null);
      try {
        const outcome = await api.post<{ saved: boolean; path?: string }>(`/api/jobs/${jobId}/save`);
        if (outcome.saved) setSaved({ jobId, path: outcome.path! });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The file could not be saved.");
      } finally {
        setSaving(false);
      }
    },
    reveal: (jobId: string) => void api.post(`/api/jobs/${jobId}/reveal`).catch(() => {}),
  };
}

/** The Save as… button, with where the file went and a way to open that folder. */
export function SaveBox({
  jobId,
  flow,
  disabled,
}: {
  jobId: string;
  flow: ReturnType<typeof useSaveFlow>;
  /** For when the result on screen is about to be replaced. */
  disabled?: boolean;
}) {
  const savedPath = flow.savedPathFor(jobId);
  return (
    <div className="box grid gap-3">
      <button
        type="button"
        className="btn btn-primary min-h-14 text-lg"
        disabled={flow.saving || disabled}
        onClick={() => void flow.save(jobId)}
      >
        <Save />
        {flow.saving ? "Choose where to save…" : savedPath ? "Save another copy…" : "Save as…"}
      </button>
      {savedPath && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-start gap-2">
            <Check className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              Saved to <span className="value text-sm break-all">{savedPath}</span>
            </span>
          </p>
          <button type="button" className="btn" onClick={() => flow.reveal(jobId)}>
            <Folder />
            Show in folder
          </button>
        </div>
      )}
      {flow.error && (
        <p className="flex items-start gap-2 font-semibold" role="alert">
          <Alert className="mt-0.5 shrink-0 text-signal-ink" />
          {flow.error}
        </p>
      )}
    </div>
  );
}
