import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import { loadYtQuality, type YtQuality } from "../../app/ytQuality";

export interface YtSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

export interface YtDlpGateway {
  search(query: string, limit: number): Promise<YtSearchResult[]>;
  stream(videoId: string, quality?: YtQuality): Promise<string>;
}

function cover(thumb?: string): string | undefined {
  return thumb?.replace("hq720", "mqdefault").replace("hqdefault", "mqdefault");
}

const STREAM_TTL_MS = 2 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = "youtube";
  readonly name = "YouTube Music";

  private streamCache = new Map<string, { url: string; at: number }>();
  private searchCache = new Map<string, { results: SearchResults; at: number }>();

  constructor(private gateway: YtDlpGateway) {}

  async search(query: string): Promise<SearchResults> {
    const key = query.trim().replace(/\s+/g, " ").toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;
    const entries = await this.gateway.search(query, 20);
    const tracks: Track[] = entries.map((e, i) => ({
      id: `youtube:track:${e.id}`,
      provider: this.id,
      uri: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title,
      artist: e.uploader,
      coverUrl: cover(e.thumbnail),
      duration: e.duration ?? undefined,
      meta: { ytId: e.id, searchIndex: i },
    }));
    const results: SearchResults = { provider: this.id, tracks, albums: [], artists: [] };
    this.searchCache.set(key, { results, at: Date.now() });
    this.prune(this.searchCache, SEARCH_TTL_MS);
    return results;
  }

  async resolveUri(track: Track): Promise<string> {
    const ytId = track.meta?.ytId as string | undefined;
    const fromId = track.id.split(":").pop();
    const id = ytId ?? fromId;
    if (!id) throw new Error("youtube: no video id");
    const quality = loadYtQuality();
    const key = `${id}:${quality}`;
    const hit = this.streamCache.get(key);
    if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.url;
    const url = await this.gateway.stream(id, quality);
    this.streamCache.set(key, { url, at: Date.now() });
    this.prune(this.streamCache, STREAM_TTL_MS);
    return url;
  }

  invalidateStream(trackId: string): void {
    const fromId = trackId.split(":").pop();
    if (!fromId) return;
    const quality = loadYtQuality();
    const key = `${fromId}:${quality}`;
    this.streamCache.delete(key);
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
    throw new Error("youtube provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("youtube provider: no artists");
  }

  async getSimilarTracks(artist: string, _track: string): Promise<Track[]> {
    if (!artist) return [];
    try {
      const entries = await this.gateway.search(`${artist} music`, 10);
      return entries.map((e) => ({
        id: `youtube:track:${e.id}`,
        provider: this.id,
        uri: `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title,
        artist: e.uploader,
        coverUrl: cover(e.thumbnail),
        duration: e.duration ?? undefined,
        meta: { ytId: e.id },
      }));
    } catch {
      return [];
    }
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    if (!artist) return [];
    try {
      const entries = await this.gateway.search(`${artist} similar artist`, 8);
      return entries.map((e) => e.uploader ?? "").filter((n) => n && n !== artist).slice(0, 8);
    } catch {
      return [];
    }
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    return this.getSimilarTracks(artist, "");
  }
}
