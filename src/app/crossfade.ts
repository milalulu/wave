const KEY = "wave:crossfade-ms";

export const CROSSFADE_MIN = 0;
export const CROSSFADE_MAX = 10000;
export const CROSSFADE_STEP = 50;
export const CROSSFADE_OPTIONS = [0, 150, 300, 500, 1000];

export function loadCrossfadeMs(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 300;
    const v = Number(raw);
    return v >= CROSSFADE_MIN && v <= CROSSFADE_MAX ? v : 300;
  } catch {
    return 300;
  }
}

export function saveCrossfadeMs(ms: number): void {
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {
    
  }
}
