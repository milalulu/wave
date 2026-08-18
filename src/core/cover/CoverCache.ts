const KEY = "wave:covers";
const TTL = 30 * 24 * 3600 * 1000;
const MAX_BYTES = 2_500_000;

interface CoverEntry {
  data: string;
  at: number;
}

let memCache: Map<string, CoverEntry> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureMemCache(): Map<string, CoverEntry> {
  if (memCache) return memCache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, CoverEntry>;
    memCache = new Map(Object.entries(raw));
  } catch {
    memCache = new Map();
  }
  return memCache;
}

function flushWrite(): void {
  writeTimer = null;
  if (!memCache) return;
  try {
    const now = Date.now();
    const clean: Record<string, CoverEntry> = {};
    let size = 0;
    for (const [url, e] of memCache) {
      if (now - e.at > TTL) continue;
      clean[url] = e;
      size += e.data.length;
    }
    if (size > MAX_BYTES) {
      const sorted = Object.entries(clean).sort((a, b) => a[1].at - b[1].at);
      while (size > MAX_BYTES && sorted.length > 0) {
        const [url, e] = sorted.shift() as [string, CoverEntry];
        delete clean[url];
        size -= e.data.length;
      }
    }
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(flushWrite, 1000);
}

export function getCachedCover(url: string): string | null {
  const e = ensureMemCache().get(url);
  if (!e || Date.now() - e.at > TTL) return null;
  return e.data;
}

export function clearCoverCache(): void {
  memCache = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    
  }
}

export async function cacheCover(url: string): Promise<string | null> {  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const data = await blobToDataUrl(blob);
    if (data.length < 100) return null;
    const cache = ensureMemCache();
    cache.set(url, { data, at: Date.now() });
    scheduleWrite();
    return data;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
