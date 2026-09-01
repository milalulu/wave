import { memo } from "react";
import { useApp } from "../app/stores";
import { formatTime } from "../core/util/format";

export const ElapsedTime = memo(function ElapsedTime({ speed }: { speed: number }) {
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  return (
    <span className="hero-meta-item">
      {formatTime(position)} / {formatTime(storeDuration)}
      {speed !== 1 && <> · {speed}×</>}
    </span>
  );
});
