const KEY = "wave:crossfade-ms";

export const CROSSFADE_OPTIONS = [0, 150, 300, 500, 1000];

export function loadCrossfadeMs(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 300;
    const v = Number(raw);
    return CROSSFADE_OPTIONS.includes(v) ? v : 300;
  } catch {
    return 300;
  }
}

export function saveCrossfadeMs(ms: number): void {
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {
    /* игнорируем переполнение localStorage */
  }
}
