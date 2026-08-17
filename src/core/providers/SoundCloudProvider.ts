import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";

export interface ScSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

export interface SoundCloudDlpGateway {
  search(query: string, limit: number): Promise<ScSearchResult[]>;
  stream(url: string): Promise<string>;
}

const STREAM_TTL_MS = 20 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;

function cover(thumb?: string): string | undefined {
  if (!thumb) return undefined;
  return thumb.replace("-mini.jpg", "-t500x500.jpg");
}

function trackUrl(id: string): string {
  return `https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A${id}`;
}

export class SoundCloudProvider implements MusicProvider {
  readonly id = "soundcloud";
  readonly name = "SoundCloud";

  constructor(private gateway: SoundCloudDlpGateway) {}

  private streamCache = new Map<string, { url: string; at: number }>();
  private searchCache = new Map<string, { results: SearchResults; at: number }>();

  async search(query: string): Promise<SearchResults> {
    const key = query.trim().replace(/\s+/g, " ").toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;
    const entries = await this.gateway.search(query, 20);
    const tracks: Track[] = entries.map((e) => ({
      id: `soundcloud:track:${e.id}`,
      provider: this.id,
      uri: `soundcloud:track:${e.id}`,
      title: e.title ?? "Unknown",
      artist: e.uploader,
      coverUrl: cover(e.thumbnail),
      duration: e.duration ? Math.round(e.duration) : undefined,
      meta: { scId: e.id, scUrl: trackUrl(e.id) },
    }));
    const results: SearchResults = { provider: this.id, tracks, albums: [], artists: [] };
    this.searchCache.set(key, { results, at: Date.now() });
    this.prune(this.searchCache, SEARCH_TTL_MS);
    return results;
  }

  async resolveUri(track: Track): Promise<string> {
    const scId = (track.meta?.scId as string | undefined) ?? String(track.id.split(":").pop());
    if (!scId) throw new Error("soundcloud: no track id");
    const url = (track.meta?.scUrl as string | undefined) ?? trackUrl(scId);
    const hit = this.streamCache.get(scId);
    if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.url;
    const direct = await this.gateway.stream(url);
    this.streamCache.set(scId, { url: direct, at: Date.now() });
    this.prune(this.streamCache, STREAM_TTL_MS);
    return direct;
  }

  private prune<K>(cache: Map<K, { at: number }>, ttl: number): void {
    if (cache.size <= 64) return;
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.at > ttl) cache.delete(k);
    }
    if (cache.size > 64) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("soundcloud provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("soundcloud provider: no artists");
  }
}
