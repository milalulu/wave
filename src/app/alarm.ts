export interface AlarmDef {
  enabled: boolean;
  hour: number;
  minute: number;
  mode: "wave" | "playlist";
  playlistId?: string;
}

const KEY = "wave:alarm";

export function loadAlarm(): AlarmDef | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<AlarmDef>;
    const hour = typeof p.hour === "number" ? Math.min(23, Math.max(0, Math.floor(p.hour))) : 7;
    const minute = typeof p.minute === "number" ? Math.min(59, Math.max(0, Math.floor(p.minute))) : 0;
    return {
      enabled: p.enabled === true,
      hour,
      minute,
      mode: p.mode === "playlist" ? "playlist" : "wave",
      playlistId: typeof p.playlistId === "string" ? p.playlistId : undefined,
    };
  } catch {
    return null;
  }
}

export function saveAlarm(a: AlarmDef | null): void {
  try {
    if (!a) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(a));
  } catch {}
}

/** Ближайшее срабатывание (сегодня, иначе завтра), epoch-ms. */
export function nextAlarmTimestamp(hour: number, minute: number, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
