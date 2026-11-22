import { create } from "zustand";

const KEY = "wave:lyrics-appearance";
export type LyricsAppearance = {
  size: "small" | "medium" | "large";
  font: "sans" | "serif" | "mono";
  timing: "line" | "word";
  effects: boolean;
};

export const DEFAULT_LYRICS_APPEARANCE: LyricsAppearance = { size: "medium", font: "sans", timing: "line", effects: true };

function load(): LyricsAppearance {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LyricsAppearance> | null;
    return {
      size: value?.size === "small" || value?.size === "large" ? value.size : "medium",
      font: value?.font === "serif" || value?.font === "mono" ? value.font : "sans",
      timing: value?.timing === "word" ? "word" : "line",
      effects: value?.effects !== false,
    };
  } catch {
    return { ...DEFAULT_LYRICS_APPEARANCE };
  }
}

export const useLyricsAppearance = create<{
  appearance: LyricsAppearance;
  setAppearance: (patch: Partial<LyricsAppearance>) => void;
}>((set) => ({
  appearance: load(),
  setAppearance: (patch) => set(({ appearance }) => {
    const next = { ...appearance, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep changes for this session. */ }
    return { appearance: next };
  }),
}));
