interface CachedStream {
  url: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const STORAGE_KEY = "wave:stream-cache";

function parseUrlExpire(url: string): number | null {
  try {
    const u = new URL(url);
    const expire = u.searchParams.get("expire");
    if (expire) {
      const ts = parseInt(expire, 10) * 1000;
      if (ts > Date.now()) return ts;
    }
  } catch {}
  return null;
}

class StreamCache {
  private cache = new Map<string, CachedStream>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.load();
  }

  get(trackId: string): string | null {
    const item = this.cache.get(trackId);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(trackId);
      return null;
    }
    return item.url;
  }

  set(trackId: string, url: string): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    const urlExpire = parseUrlExpire(url);
    const expiresAt = urlExpire
      ? Math.min(urlExpire, Date.now() + DEFAULT_TTL_MS)
      : Date.now() + DEFAULT_TTL_MS;
    this.cache.set(trackId, { url, expiresAt });
    this.scheduleSave();
  }

  invalidate(trackId: string): void {
    this.cache.delete(trackId);
    this.scheduleSave();
  }

  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries: [string, CachedStream][] = JSON.parse(raw);
      const now = Date.now();
      for (const [k, v] of entries) {
        if (v.expiresAt > now) this.cache.set(k, v);
      }
    } catch {}
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 1000);
  }

  private save(): void {
    try {
      const entries = [...this.cache.entries()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {}
  }
}

export const streamCache = new StreamCache();
