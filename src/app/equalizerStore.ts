import { EQ_FREQUENCIES } from "../core/player/equalizerPresets";

const KEY = "wave:equalizer";

export function loadSavedEqualizer(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as number[];
    if (
      !Array.isArray(data) ||
      data.length !== EQ_FREQUENCIES.length ||
      data.some((g) => typeof g !== "number" || !Number.isFinite(g))
    ) {
      return [];
    }
    return data;
  } catch {
    return [];
  }
}

export function saveEqualizer(gains: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(gains));
  } catch {
    
  }
}
