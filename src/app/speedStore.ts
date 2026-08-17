const KEY = "wave:speed";

export function loadSavedSpeed(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0.5 || n > 2) return null;
    return n;
  } catch {
    return null;
  }
}

export function saveSpeed(rate: number): void {
  try {
    localStorage.setItem(KEY, String(rate));
  } catch {
    
  }
}
