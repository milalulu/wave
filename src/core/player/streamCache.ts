interface CachedStream {
  url: string;
  quality: string;
  expiresAt: number;
}

const STREAM_TTL_MS = 45 * 60 * 1000;
const EXPIRY_SAFETY_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

/** Unix-секунды из `?expire=`/`?Expires=` или из пути `/expire/<sec>/` (googlevideo). */
function expiryFromUrl(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Ссылка через локальный прокси несёт оригинальный URL в query.
  const proxied = parsed.searchParams.get("url");
  if (proxied) return expiryFromUrl(proxied);
  const param = parsed.searchParams.get("expire") ?? parsed.searchParams.get("Expires");
  const fromPath = /\/expire\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1];
  const seconds = Number(param ?? fromPath);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function expiresAtFor(url: string): number {
  const now = Date.now();
  const expiry = expiryFromUrl(url);
  if (expiry === null) return now + STREAM_TTL_MS;
  return Math.min(expiry - EXPIRY_SAFETY_MS, now + STREAM_TTL_MS);
}

class StreamCache {
  private cache = new Map<string, CachedStream>();

  get(trackId: string, quality = ""): string | null {
    const item = this.cache.get(trackId);
    if (!item) return null;
    if (item.quality !== quality || Date.now() > item.expiresAt) {
      this.cache.delete(trackId);
      return null;
    }
    return item.url;
  }

  set(trackId: string, url: string, quality = ""): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(trackId, {
      url,
      quality,
      expiresAt: expiresAtFor(url),
    });
  }

  invalidate(trackId: string): void {
    this.cache.delete(trackId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const streamCache = new StreamCache();
