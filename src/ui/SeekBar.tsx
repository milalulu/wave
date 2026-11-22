import { memo, useEffect, useRef } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { formatTime } from "../core/util/format";
import { playbackSource, type Track } from "../core/types";
import progressSvg from "../assets/echoes-progress.svg?raw";

// Follow an actual strand of the artwork, using its original viewBox coordinates.
const centerPath = progressSvg.match(/<path d="([^"]+)" id="seek-center"/)?.[1] ?? "M0,35 L600,35";
const points = [...centerPath.matchAll(/[ML]([\d.]+),([\d.]+)/g)]
  .map((p) => ({ x: Number(p[1]), y: Number(p[2]) }));
function curveY(fraction: number) {
  const x = fraction * 600;
  const i = points.findIndex((p) => p.x >= x);
  if (i <= 0) return points[i < 0 ? points.length - 1 : 0].y;
  const a = points[i - 1], b = points[i];
  return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
}

export const SeekBar = memo(function SeekBar({track, className = "player-progress"}: {
  track: Track | null; className?: string;
}) {
  const { t } = useI18n();
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  const state = useApp((s) => s.snapshot.state);
  const engine = useApp((s) => s.services?.engine);
  const seek = useApp((s) => s.seek);
  const input = useRef<HTMLInputElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const duration = storeDuration > 0 ? storeDuration : track ? playbackSource(track).duration ?? track.duration ?? 0 : 0;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const livePosition = state === "playing" ? engine?.getPlaybackPosition() : undefined;
      const value = Math.max(0, Math.min(livePosition ?? position, duration));
      const fraction = duration > 0 ? value / duration : 0;
      if (input.current) input.current.value = String(value);
      if (dot.current) {
        dot.current.style.left = `${fraction * 100}%`;
        dot.current.style.top = `${curveY(fraction) / 70 * 100}%`;
      }
      if (state === "playing" && engine && duration > 0) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [position, duration, state, engine, track?.id]);
  return <div className={`${className} echoes-seek`}>
    <span className="time">{formatTime(position)}</span>
    <div className="echoes-seek-curve">
      <input ref={input} type="range" className="seek" min={0} max={duration || 100} step={.01}
        defaultValue={position} disabled={!track || duration <= 0} aria-label={t("player").seek}
        onChange={(e) => seek(Number(e.target.value))} />
      <span ref={dot} className="echoes-seek-dot" aria-hidden="true" />
    </div>
    <span className="time">{formatTime(duration)}</span>
  </div>;
});
