import { normalizeEqualizer } from "../core/player/equalizerPresets";

const KEY = "wave:equalizer";

export function loadSavedEqualizer(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) && data.length ? normalizeEqualizer(data) : [];
  } catch {
    return [];
  }
}

export function saveEqualizer(gains: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeEqualizer(gains)));
  } catch {
    
  }
}
