type Props = {
  /** Big heading, e.g. "Converting". */
  title: string;
  progress: number;
  /** For stages with no honest percentage: a sweeping bar and no number. */
  indeterminate?: boolean;
  note?: string;
  onCancel?: () => void;
  cancelDisabled?: boolean;
};

/** A blank label being printed: the ink line wipes across as work advances. */
export function PrintProgress({ title, progress, indeterminate, note, onCancel, cancelDisabled }: Props) {
  return (
    <>
      <div
        className="box relative min-h-40 overflow-hidden"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(progress * 100)}
        aria-valuetext={indeterminate ? note : undefined}
      >
        {indeterminate ? (
          <div className="sweep absolute inset-y-0 left-0 w-1/3 bg-ink" />
        ) : (
          <div className="print-fill absolute inset-0 bg-ink" style={{ scale: `${progress} 1` }} />
        )}
        <div className="relative flex min-h-32 flex-wrap items-end justify-between gap-4 text-stock mix-blend-difference">
          <p className="code text-5xl sm:text-7xl">{title}</p>
          {!indeterminate && <p className="value text-3xl">{Math.round(progress * 100)}%</p>}
        </div>
      </div>
      <div className="box flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-soft" aria-live="polite">
          {note}
        </p>
        {onCancel && (
          <button type="button" className="btn" disabled={cancelDisabled} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  );
}
