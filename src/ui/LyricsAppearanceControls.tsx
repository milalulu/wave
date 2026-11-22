import { useId, useState } from "react";
import { useLyricsAppearance } from "../app/lyricsAppearance";

export function LyricsAppearanceControls({ locale, wordTimings }: { locale: string; wordTimings: boolean }) {
  const { appearance, setAppearance } = useLyricsAppearance();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ru = locale === "ru";
  return <div className="lyrics-appearance">
    <button type="button" className="btn small" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {ru ? "Вид текста" : "Text appearance"}
    </button>
    {open && <div id={id} className="lyrics-appearance-panel">
      <label>
        {ru ? "Размер" : "Size"}
        <select aria-label={ru ? "Размер" : "Size"} value={appearance.size}
          onChange={(event) => setAppearance({ size: event.target.value as typeof appearance.size })}>
          <option value="small">{ru ? "Мелкий" : "Small"}</option>
          <option value="medium">{ru ? "Обычный" : "Medium"}</option>
          <option value="large">{ru ? "Крупный" : "Large"}</option>
        </select>
      </label>
      <label>
        {ru ? "Шрифт" : "Typeface"}
        <select aria-label={ru ? "Шрифт" : "Typeface"} value={appearance.font}
          onChange={(event) => setAppearance({ font: event.target.value as typeof appearance.font })}>
          <option value="sans">{ru ? "Без засечек" : "Sans serif"}</option>
          <option value="serif">{ru ? "С засечками" : "Serif"}</option>
          <option value="mono">{ru ? "Моноширинный" : "Monospace"}</option>
        </select>
      </label>
      <label>
        {ru ? "Подсветка в тексте" : "Text highlighting"}
        <select aria-label={ru ? "Подсветка в тексте" : "Text highlighting"} value={appearance.timing}
          onChange={(event) => setAppearance({ timing: event.target.value as typeof appearance.timing })}>
          <option value="line">{ru ? "По строкам" : "Line by line"}</option>
          <option value="word">{ru ? "По словам" : "Word by word"}</option>
        </select>
      </label>
      <label className="lyrics-appearance-effects">
        <input type="checkbox" checked={appearance.effects} onChange={(event) => setAppearance({ effects: event.target.checked })} />
        {ru ? "Анимация сцены" : "Scene animation"}
      </label>
      {appearance.timing === "word" && !wordTimings && <p className="muted">{ru
        ? "У этой записи нет таймингов слов. Подсветка идёт по строкам."
        : "This recording has no word timings. Lyrics are highlighted line by line."}</p>}
    </div>}
  </div>;
}
