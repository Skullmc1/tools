import { type InputHTMLAttributes, useEffect, useState } from "react";

type Props = {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "min" | "max" | "onChange">;

/**
 * A number input that lets you type freely: values in range apply as you
 * type, and anything else is clamped when you leave the field.
 */
export function NumberField({ value, min, max, onCommit, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const parsed = text.trim() === "" ? NaN : Number(text);

  return (
    <input
      type="number"
      className="input"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      onChange={(event) => {
        setText(event.target.value);
        const next = event.target.value.trim() === "" ? NaN : Number(event.target.value);
        if (Number.isFinite(next) && next >= min && next <= max) onCommit(next);
      }}
      onBlur={() => {
        if (!Number.isFinite(parsed)) return setText(String(value));
        const clamped = Math.min(max, Math.max(min, parsed));
        setText(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
      {...rest}
    />
  );
}
