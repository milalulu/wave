import type { CSSProperties } from "react";

export function VolumeSlider({ value, onChange, label }: {
  value: number;
  onChange: (percent: number) => void;
  label: string;
}) {
  return (
    <input
      type="range"
      className="volume"
      min={0}
      max={100}
      step={1}
      value={value}
      aria-label={label}
      aria-valuetext={`${value}%`}
      style={{ "--volume-pct": `${value}%` } as CSSProperties}
      onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
    />
  );
}
