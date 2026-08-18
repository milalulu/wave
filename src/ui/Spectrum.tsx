import { useEffect, useRef } from "react";
import type { PlayerEngine } from "../core/player/PlayerEngine";

const BARS = 48;
const BAR_W = 3;
const BAR_GAP = 1;
const HEIGHT = 52;

export function Spectrum({ engine }: { engine: PlayerEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = BARS * (BAR_W + BAR_GAP) - BAR_GAP;
    canvas.width = cssWidth * dpr;
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext("2d");
    if (!g) return;

    const cssColor = getComputedStyle(canvas).color || "#7c5cff";
    const data = new Uint8Array(128);
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      engine.getSpectrum(data);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const bins = data.length;
      for (let b = 0; b < BARS; b++) {
        const lo = Math.floor(Math.pow(b / BARS, 1.6) * bins);
        const hi = Math.min(bins, Math.floor(Math.pow((b + 1) / BARS, 1.6) * bins));
        let v = 0;
        for (let i = lo; i < hi; i++) {
          if (data[i] > v) v = data[i];
        }
        const h = Math.max(2, (v / 255) * HEIGHT);
        const x = b * (BAR_W + BAR_GAP) * dpr;
        const barH = h * dpr;
        const y = (HEIGHT - h) * dpr;
        const radius = Math.min(BAR_W * dpr * 0.5, barH * 0.4);
        g.fillStyle = cssColor;
        g.globalAlpha = 0.4 + (v / 255) * 0.6;
        g.beginPath();
        g.roundRect(x, y, BAR_W * dpr, barH, radius);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <canvas
      className="spectrum"
      ref={canvasRef}
      style={{ width: BARS * (BAR_W + BAR_GAP) - BAR_GAP, height: HEIGHT }}
      aria-hidden
    />
  );
}
