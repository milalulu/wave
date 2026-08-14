const KEY = "wave:covers";
const TTL = 30 * 24 * 3600 * 1000;
const MAX_BYTES = 2_500_000;

interface CoverEntry {
  data: string;
  at: number;
}

function read(): Record<string, CoverEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, CoverEntry>;
  } catch {
    return {};
  }
}

function write(map: Record<string, CoverEntry>): void {
  try {
    const now = Date.now();
    const clean: Record<string, CoverEntry> = {};
    let size = 0;
    for (const [url, e] of Object.entries(map)) {
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
    /* переполнение/приватный режим — игнорируем */
  }
}

export function getCachedCover(url: string): string | null {
  const e = read()[url];
  if (!e || Date.now() - e.at > TTL) return null;
  return e.data;
}

/** Полностью очистить кэш обложек. */
export function clearCoverCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* игнорируем */
  }
}

/** Загрузить обложку в data-URL и положить в кэш (оффлайн). */
export async function cacheCover(url: string): Promise<string | null> {  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const data = await blobToDataUrl(blob);
    if (data.length < 100) return null;
    const map = read();
    map[url] = { data, at: Date.now() };
    write(map);
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
