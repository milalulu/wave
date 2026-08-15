import type { Track } from "../core/types";

const KEY = "wave:queue-restore";
const TTL = 7 * 24 * 3600 * 1000;
/** Ограничиваем размер сохраняемой очереди (лимит localStorage ~5MB). */
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
    if (!Array.isArray(data.queue) || data.queue.length === 0) return null;
    if (Date.now() - (data.savedAt ?? 0) > TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveRestore(queue: Track[], index: number, position: number): void {
  try {
    const slice = queue.slice(0, MAX_TRACKS);
    // Обложки — самый тяжёлый кусок, для restore они не нужны (подтянутся
    // при показе/игре). Так запись не упирается в квоту localStorage.
    const compact: Track[] = slice.map((t) =>
      t.coverUrl ? { ...t, coverUrl: undefined } : t,
    );
    localStorage.setItem(
      KEY,
      JSON.stringify({ queue: compact, index, position, savedAt: Date.now() }),
    );
  } catch {
    /* переполнение localStorage — молча игнорируем */
  }
}

export function clearRestore(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* localStorage недоступен — молча игнорируем */
  }
}
