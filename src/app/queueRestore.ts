import type { Track } from "../core/types";

const KEY = "wave:queue-restore";
const TTL = 7 * 24 * 3600 * 1000;

const MAX_TRACKS = 300;

export interface RestoreState {
  queue: Track[];
  index: number;
  position: number;
  savedAt: number;
}

export function loadRestore(): RestoreState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as RestoreState;
    if (!data || !Array.isArray(data.queue) || data.queue.length === 0) return null;
    if (!data.queue.every((track) => track && typeof track.id === "string"
      && typeof track.provider === "string" && typeof track.title === "string"
      && typeof track.uri === "string")) return null;
    if (!Number.isInteger(data.index) || data.index < 0 || data.index >= data.queue.length) return null;
    if (!Number.isFinite(data.position) || data.position < 0) return null;
    if (!Number.isFinite(data.savedAt) || Date.now() - data.savedAt > TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveRestore(queue: Track[], index: number, position: number): void {
  try {
    if (queue.length === 0) { clearRestore(); return; }
    const current = Number.isFinite(index) ? Math.max(0, Math.min(Math.trunc(index), queue.length - 1)) : 0;
    // Keep the active track inside the saved window, including on long playlists.
    const start = Math.max(0, Math.min(current - Math.floor(MAX_TRACKS / 2), queue.length - MAX_TRACKS));
    const slice = queue.slice(start, start + MAX_TRACKS);
    
    
    const compact: Track[] = slice.map((t) =>
      t.coverUrl ? { ...t, coverUrl: undefined } : t,
    );
    localStorage.setItem(
      KEY,
      JSON.stringify({ queue: compact, index: current - start,
        position: Number.isFinite(position) ? Math.max(0, position) : 0, savedAt: Date.now() }),
    );
  } catch {
    
  }
}

export function clearRestore(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    
  }
}
