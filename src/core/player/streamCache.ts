interface CachedStream {
  url: string;
  expiresAt: number;
}

const STREAM_TTL_MS = 45 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

class StreamCache {
  private cache = new Map<string, CachedStream>();

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
    this.cache.set(trackId, {
      url,
      expiresAt: Date.now() + STREAM_TTL_MS,
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
