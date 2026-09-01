import { memo } from "react";
import { useApp } from "../app/stores";

export const ProgressBar = memo(function ProgressBar({
  duration,
}: {
  duration?: number | null;
}) {
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  const dur = duration ?? storeDuration;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  return (
    <span className="mini-progress">
      <span
        className="mini-progress-fill"
        style={{ display: "block", width: `${pct}%` }}
      />
    </span>
  );
});
