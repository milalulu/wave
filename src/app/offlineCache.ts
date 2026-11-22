import { playbackSource, type Track } from "../core/types";
import { fetchMediaBlob } from "../core/player/mediaMemoryFallback";

const KEY = "wave:offline-cache";
const LIMIT = 128 * 1024 * 1024;
const STORE = "audio";
const urls = new Map<string, string>();
let database: Promise<IDBDatabase> | undefined;
let inFlight = false;
let cacheRevision = 0;

type Entry = { id: string; audio: Blob; size: number; lastUsed: number };
type CacheMode = "off" | "wifi" | "any";

export function loadOfflineCacheMode(): CacheMode {
  try {
    const mode = localStorage.getItem(KEY);
    if (mode === "wifi" || mode === "any") return mode;
  } catch { /* Storage may be unavailable. */ }
  return "off";
}

export function saveOfflineCacheMode(mode: CacheMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* Storage may be unavailable. */ }
}

function openCache(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("wave-offline-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => { database = undefined; throw error; });
}

export async function getOfflineCacheUsage(): Promise<{ tracks: number; bytes: number }> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const result = { tracks: 0, bytes: 0 };
    const request = db.transaction(STORE).objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(result); return; }
      const { size } = cursor.value as Entry;
      result.tracks++;
      result.bytes += size;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearOfflineCache(): Promise<void> {
  cacheRevision++;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  // Leave current media/preload references alive until they finish the handoff.
  const previous = [...urls.values()];
  urls.clear();
  if (previous.length) globalThis.setTimeout(() => previous.forEach(URL.revokeObjectURL), 120_000);
}

function canCache(): boolean {
  const mode = loadOfflineCacheMode();
  const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return navigator.onLine && !connection?.saveData && (mode === "any" ||
    (mode === "wifi" && connection?.type === "wifi"));
}

export async function cachedAudioUri(track: Track): Promise<string | null> {
  if (loadOfflineCacheMode() === "off") return null;
  const id = playbackSource(track).id;
  const revision = cacheRevision;
  const current = urls.get(id);
  if (current) {
    urls.delete(id);
    urls.set(id, current);
    return current;
  }
  try {
    const db = await openCache();
    const audio = await new Promise<Blob | null>((resolve, reject) => {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        const entry: Entry | undefined = request.result;
        if (entry) store.put({ ...entry, lastUsed: Date.now() });
        resolve(entry?.audio ?? null);
      };
      request.onerror = () => reject(request.error);
    });
    if (!audio || revision !== cacheRevision) return null;
    const concurrent = urls.get(id);
    if (concurrent) return concurrent;
    const url = URL.createObjectURL(audio);
    urls.set(id, url);
    // Old object URLs expire after the current media element or preloader has consumed them.
    if (urls.size > 8) {
      const oldest = urls.entries().next().value;
      if (oldest) {
        urls.delete(oldest[0]);
        globalThis.setTimeout(() => URL.revokeObjectURL(oldest[1]), 120_000);
      }
    }
    return url;
  } catch { return null; }
}

export async function cachePlayedAudio(track: Track, resolveUri: (track: Track) => Promise<string>): Promise<void> {
  const source = playbackSource(track);
  if (inFlight || source.provider !== "soundcloud" || source.meta?.downloadable !== true || !canCache()) return;
  inFlight = true;
  const revision = cacheRevision;
  try {
    if (await cachedAudioUri(source)) return;
    const url = new URL(await resolveUri(source));
    if (url.pathname !== "/audio" || url.hostname !== "127.0.0.1" || url.port !== "8299") return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
    const audio = await fetchMediaBlob(url.href, controller.signal).finally(() => globalThis.clearTimeout(timer));
    if (!audio.size || !audio.type.startsWith("audio/") || !canCache()) return;
    const db = await openCache();
    if (revision !== cacheRevision) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const entries: { id: string; size: number; lastUsed: number }[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const { id, size, lastUsed } = cursor.value as Entry;
          if (id !== source.id) entries.push({ id, size, lastUsed });
          cursor.continue();
          return;
        }
        let size = audio.size;
        for (const entry of entries.sort((a, b) => b.lastUsed - a.lastUsed)) {
          if (size + entry.size > LIMIT) store.delete(entry.id);
          else size += entry.size;
        }
        store.put({ id: source.id, audio, size: audio.size, lastUsed: Date.now() } satisfies Entry);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { inFlight = false; }
}
