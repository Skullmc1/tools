type Option<T> = { value: T; label: string };

type Props<T> = {
  /** Shared radio group name; also the accessible label. */
  name: string;
  options: Option<T>[];
  value: T | null;
  disabled?: boolean;
  onChange: (value: T) => void;
};

/** A one-of-many choice printed as a row of cells. */
export function Segmented<T extends string | number>({ name, options, value, disabled, onChange }: Props<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            className="sr-only"
            name={name}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
