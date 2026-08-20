const KEY = "wave:history-decay-days";

export const HISTORY_DECAY_MIN = 7;
export const HISTORY_DECAY_MAX = 90;
export const HISTORY_DECAY_DEFAULT = 30;

export function loadHistoryDecayDays(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return HISTORY_DECAY_DEFAULT;
    const v = Number(raw);
    return v >= HISTORY_DECAY_MIN && v <= HISTORY_DECAY_MAX ? v : HISTORY_DECAY_DEFAULT;
  } catch {
    return HISTORY_DECAY_DEFAULT;
  }
}

export function saveHistoryDecayDays(days: number): void {
  try {
    localStorage.setItem(KEY, String(days));
  } catch {
    
  }
}
