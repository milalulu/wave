import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SceneEvent } from "./lyricsAtmosphere";
import { paintAtmosphere } from "./lyricsAtmosphereArt";

export function LyricsAtmosphere({ events, position }: { events: SceneEvent[]; position: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (reduced || !element) return;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize({ width, height });
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  useLayoutEffect(() => {
    const element = canvas.current;
    const { width, height } = size;
    if (reduced || !element || !width || !height) return;
    const ratio = Math.min(1.6, window.devicePixelRatio || 1);
    const physicalWidth = Math.round(width * ratio);
    const physicalHeight = Math.round(height * ratio);
    if (element.width !== physicalWidth) element.width = physicalWidth;
    if (element.height !== physicalHeight) element.height = physicalHeight;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const event of events) {
      ctx.save();
      paintAtmosphere(ctx, width, height, event, position);
      ctx.restore();
    }
  }, [events, position, reduced, size]);

  return <canvas ref={canvas} className="lyrics-atmosphere" data-atmosphere={events.map(({ kind }) => kind).join(" ")} aria-hidden="true" />;
}
