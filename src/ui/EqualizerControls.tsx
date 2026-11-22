import type { CSSProperties } from "react";
import { useApp } from "../app/stores";
import { EQ_FREQUENCIES, EQ_GAIN_LIMIT, EQ_PRESETS, normalizeEqualizer } from "../core/player/equalizerPresets";
import { useI18n } from "./I18nContext";
import { LimiterMeter } from "./LimiterMeter";

export function EqualizerControls() {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const engine = useApp((state) => state.services?.engine);
  const gains = useApp((state) => state.snapshot.equalizer);
  const bypassed = useApp((state) => state.effectsBypassed);
  const setBypassed = useApp((state) => state.setEffectsBypassed);
  const setEqualizer = useApp((state) => state.setEqualizer);
  return <div className="eq-controls">
    <button type="button" className="btn small eq-bypass" aria-pressed={bypassed} onClick={() => setBypassed(!bypassed)}>
      {bypassed ? (ru ? "A · Без эффектов" : "A · Effects bypassed") : (ru ? "B · С эффектами" : "B · Effects enabled")}
    </button>
    {engine && <LimiterMeter engine={engine} locale={locale} />}
    <div className="eq-presets">
      {EQ_PRESETS.map((preset) => (
        <button type="button" key={preset.id}
          aria-pressed={preset.gains.every((gain, index) => gain === (gains[index] ?? 0))}
          onClick={() => setEqualizer(preset.gains)}>
          {preset.name}
        </button>
      ))}
    </div>
    <div className="eq-sliders">
      {EQ_FREQUENCIES.map((frequency, index) => {
        const gain = gains[index] ?? 0;
        const value = `${gain > 0 ? "+" : ""}${gain}`;
        return <label className="eq-slider-col" key={frequency}>
          <span className="eq-val" aria-hidden="true">{value}</span>
          <input type="range" className="eq-slider" min={-EQ_GAIN_LIMIT} max={EQ_GAIN_LIMIT} step={1} value={gain}
            style={{ "--eq-value": `${(EQ_GAIN_LIMIT - gain) * 50 / EQ_GAIN_LIMIT}%` } as CSSProperties}
            aria-label={`${frequency} ${ru ? "Гц" : "Hz"}`} aria-valuetext={`${value} ${ru ? "дБ" : "dB"}`}
            onChange={(event) => {
              const next = normalizeEqualizer(gains);
              next[index] = Number(event.target.value);
              setEqualizer(next);
            }} />
          <span className="eq-label" aria-hidden="true">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
        </label>;
      })}
    </div>
    <button type="button" className="btn small" onClick={() => setEqualizer(normalizeEqualizer([]))}>
      {ru ? "Сбросить полосы" : "Reset bands"}
    </button>
  </div>;
}
