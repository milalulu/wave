import { useEffect, useState } from "react";
import type { PlayerEngine } from "../core/player/PlayerEngine";

export function LimiterMeter({ engine, locale }: { engine: PlayerEngine; locale: string }) {
  const [reduction, setReduction] = useState<number>();
  const [output, setOutput] = useState(() => engine.getAudioProcessingState());
  useEffect(() => {
    const read = () => {
      const value = engine.getLimiterReduction();
      setReduction(typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(-value * 10) / 10) : undefined);
      setOutput(engine.getAudioProcessingState());
    };
    read();
    const timer = window.setInterval(read, 150);
    return () => window.clearInterval(timer);
  }, [engine]);

  const ru = locale === "ru";
  if (output !== "active") {
    const status = {
      standby: ru ? "Эффекты доступны при локальном воспроизведении." : "Effects apply during local playback.",
      direct: ru ? "Этот источник воспроизводится напрямую. Эффекты недоступны." : "This source plays directly. Effects are unavailable.",
      remote: ru ? "Звук обрабатывает внешнее устройство." : "Your external device controls audio processing.",
    };
    return <p className="muted eq-output-status" role="status">{status[output]}</p>;
  }
  if (reduction === undefined) return null;
  const label = locale === "ru" ? "Ограничение пиков" : "Peak reduction";
  return <div className="eq-limiter">
    <span>{label}</span>
    <meter min={0} max={12} value={Math.min(reduction, 12)} aria-label={label} />
    <span>{reduction > 0 ? "−" : ""}{reduction.toFixed(1)} dB</span>
  </div>;
}
