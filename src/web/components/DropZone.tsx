import { type DragEvent, useRef, useState } from "react";
import { Alert } from "./icons.tsx";

export function hasAcceptedExtension(file: File, accepts: string[]): boolean {
  if (accepts.length === 0) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return accepts.includes(ext);
}

/** Drag-over state and drop handling for anything that accepts one file. */
export function useFileDrop(onFile: (file: File) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      },
    },
  };
}

type Props = {
  /** e.g. "Drop a video here" */
  title: string;
  accepts: string[];
  error?: string | null;
  onFile: (file: File) => void;
};

/** The empty state of a tool: a blank label waiting for its contents. */
export function DropZone({ title, accepts, error, onFile }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { over, handlers } = useFileDrop(onFile);

  return (
    <div className="label" {...handlers}>
      <div
        className={`box grid min-h-[22rem] place-items-center py-12 text-center transition-colors duration-150 ${
          over ? "box-inverse" : ""
        }`}
      >
        <div>
          <p className="code text-5xl sm:text-7xl">{over ? "Let go" : title}</p>
          <button type="button" className="btn btn-primary mt-8" onClick={() => input.current?.click()}>
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept={accepts.map((ext) => `.${ext}`).join(",")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {error && (
        <div className="box flex items-center gap-3 font-semibold" role="alert">
          <Alert className="shrink-0 text-signal-ink" />
          {error}
        </div>
      )}
      <div className="box">
        <span className="legend">Accepts</span>
        <p className="value mt-1">{accepts.join("  ")}</p>
      </div>
    </div>
  );
}
