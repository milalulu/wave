import { invoke } from "@tauri-apps/api/core";
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

const STREAM_TTL_MS = 5 * 60 * 1000;
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

    return this.resolveFresh(scId, url);
  }

  private async resolveFresh(scId: string, url: string): Promise<string> {
    try {
      const direct = await invoke<string>("sc_resolve_stream", { trackUrl: url });
      this.streamCache.set(scId, { url: direct, at: Date.now() });
      this.prune(this.streamCache, STREAM_TTL_MS);
      return direct;
    } catch {}

    const direct = await this.gateway.stream(url);
    this.streamCache.set(scId, { url: direct, at: Date.now() });
    this.prune(this.streamCache, STREAM_TTL_MS);
    return direct;
  }

  invalidateStream(trackId: string): void {
    const scId = (trackId.split(":").pop()) ?? "";
    if (scId) this.streamCache.delete(scId);
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

  async getSimilarTracks(artist: string, track: string, options?: import("./MusicProvider").MoodRecommendOptions): Promise<Track[]> {
    if (!artist) return [];
    try {
      let query: string;
      if (track && options?.moods?.length) {
        query = `${artist} ${track} ${options.moods[0]}`;
      } else if (track) {
        query = `${artist} ${track}`;
      } else if (options?.moods?.length) {
        query = `${artist} ${options.moods[0]} ${options.genres?.[0] ?? "music"}`;
      } else {
        query = `${artist} music`;
      }
      const entries = await this.gateway.search(query, 15);
      return entries
        .filter((e) => {
          const title = (e.title ?? "").toLowerCase();
          if (/type beat|typeBeat|\bfree beat\b|\bfree type\b/.test(title)) return false;
          if (e.duration && e.duration < 30) return false;
          return true;
        })
        .slice(0, 10)
        .map((e) => ({
          id: `soundcloud:track:${e.id}`,
          provider: this.id,
          uri: `soundcloud:track:${e.id}`,
          title: e.title ?? "Unknown",
          artist: e.uploader,
          coverUrl: cover(e.thumbnail),
          duration: e.duration ? Math.round(e.duration) : undefined,
          meta: { scId: e.id, scUrl: trackUrl(e.id) },
        }));
    } catch {
      return [];
    }
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    const results = await this.gateway.search(artist, 10);
    const names = new Set<string>();
    for (const r of results) {
      if (r.uploader && r.uploader !== artist) names.add(r.uploader);
    }
    return [...names].slice(0, 8);
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    return this.getSimilarTracks(artist, "");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("soundcloud provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("soundcloud provider: no artists");
  }
}
