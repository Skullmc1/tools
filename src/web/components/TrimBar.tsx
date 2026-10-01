import { type KeyboardEvent, type PointerEvent, useRef } from "react";

const MIN_GAP = 0.1;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MAX_TICKS = 12;

type Edge = "start" | "end";

type Props = {
  duration: number;
  start: number;
  end: number;
  /** Current playback position, in seconds. */
  playhead: number;
  disabled?: boolean;
  onChange: (range: { start: number; end: number }, moved: Edge) => void;
  onSeek: (time: number) => void;
};

/**
 * A timeline drawn to scale: the selected span's length is its duration.
 * Each end is a slider handle; clicking the bar moves the playhead.
 */
export function TrimBar({ duration, start, end, playhead, disabled, onChange, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const percent = (time: number) => `${(time / duration) * 100}%`;

  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };

  const move = (edge: Edge, time: number) => {
    const snapped = Math.round(time * 10) / 10;
    if (edge === "start") onChange({ start: Math.max(0, Math.min(snapped, end - MIN_GAP)), end }, edge);
    else onChange({ start, end: Math.min(duration, Math.max(snapped, start + MIN_GAP)) }, edge);
  };

  const handle = (edge: Edge) => {
    const value = edge === "start" ? start : end;
    return {
      role: "slider",
      tabIndex: disabled ? -1 : 0,
      "aria-label": edge === "start" ? "Start of clip" : "End of clip",
      "aria-valuemin": 0,
      "aria-valuemax": Number(duration.toFixed(1)),
      "aria-valuenow": Number(value.toFixed(1)),
      "aria-valuetext": `${value.toFixed(1)} seconds`,
      "aria-disabled": disabled,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(edge, timeAt(event.clientX));
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (disabled) return;
        const step = event.shiftKey ? 1 : 0.1;
        if (event.key === "ArrowLeft") move(edge, value - step);
        else if (event.key === "ArrowRight") move(edge, value + step);
        else if (event.key === "Home") move(edge, 0);
        else if (event.key === "End") move(edge, duration);
        else return;
        event.preventDefault();
      },
    };
  };

  const step = TICK_STEPS.find((s) => duration / s <= MAX_TICKS) ?? duration;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  const grip =
    "absolute -top-1.5 -bottom-1.5 w-4 -translate-x-1/2 touch-none rounded-[3px] border-2 border-ink bg-signal " +
    (disabled ? "cursor-not-allowed" : "cursor-ew-resize");

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div
        ref={track}
        className="relative mx-2 h-12 border-2 border-ink bg-stock"
        onPointerDown={(event) => !disabled && onSeek(timeAt(event.clientX))}
      >
        <div className="absolute inset-y-0 bg-ink" style={{ left: percent(start), width: percent(end - start) }} />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-signal"
          style={{ left: percent(Math.min(duration, playhead)) }}
        />
        <div {...handle("start")} className={grip} style={{ left: percent(start) }} />
        <div {...handle("end")} className={grip} style={{ left: percent(end) }} />
      </div>
      <div className="relative mx-2 mt-2 h-5 text-xs text-ink-soft" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="value absolute -translate-x-1/2" style={{ left: percent(tick) }}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
