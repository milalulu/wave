import { invoke } from "@tauri-apps/api/core";
import type { Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";

export interface ScSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

export interface ScUserResult {
  username: string;
  followersCount?: number;
  avatar?: string;
}

export interface SoundCloudDlpGateway {
  search(query: string, limit: number): Promise<ScSearchResult[]>;
  stream(url: string): Promise<string>;
}

const STREAM_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const RELATED_TTL_MS = 30 * 60 * 1000;

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
  private relatedCache = new Map<string, { tracks: Track[]; at: number }>();

  // Нативный поиск SoundCloud (api-v2, без yt-dlp) с фолбэком на yt-dlp gateway.
  private async searchEntries(query: string, limit: number): Promise<ScSearchResult[]> {
    try {
      return await invoke<ScSearchResult[]>("sc_search", { query, limit });
    } catch {
      return this.gateway.search(query, limit);
    }
  }

  async search(query: string): Promise<SearchResults> {
    const key = query.trim().replace(/\s+/g, " ").toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;
    const entries = await this.searchEntries(query, 20);
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

    const seen = new Set<string>();
    const artists: Artist[] = [];
    for (const t of tracks) {
      const name = t.artist;
      if (name && !seen.has(name)) {
        seen.add(name);
        artists.push({
          id: `soundcloud:artist:${encodeURIComponent(name)}`,
          provider: this.id,
          name,
          coverUrl: t.coverUrl,
        });
      }
    }

    const results: SearchResults = { provider: this.id, tracks, albums: [], artists };
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

  async getSimilarTracks(artist: string, track: string, options?: import("./MusicProvider").MoodRecommendOptions, seed?: Track): Promise<Track[]> {
    const scId = seed?.meta?.scId as string | undefined;
    if (scId) {
      const hit = this.relatedCache.get(String(scId));
      if (hit && Date.now() - hit.at < RELATED_TTL_MS) return hit.tracks;
      try {
        const related = await invoke<ScSearchResult[]>("sc_related_tracks", { trackId: String(scId), limit: 15 });
        if (related.length > 0) {
          const tracks = this.entriesToTracks(related);
          this.relatedCache.set(String(scId), { tracks, at: Date.now() });
          return tracks;
        }
      } catch {}
    }
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
      const entries = await this.searchEntries(query, 15);
      return this.entriesToTracks(entries);
    } catch {
      return [];
    }
  }

  private entriesToTracks(entries: ScSearchResult[]): Track[] {
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
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    // Настоящая похожесть: берём трек артиста, смотрим related-треки,
    // похожие артисты — их distinct uploaders. Поиск юзеров — только фолбэк.
    try {
      const entries = await this.searchEntries(artist, 5);
      const lower = artist.toLowerCase();
      const seed =
        entries.find((e) => (e.uploader ?? "").toLowerCase() === lower) ?? entries[0];
      if (seed) {
        const related = await invoke<ScSearchResult[]>("sc_related_tracks", {
          trackId: String(seed.id),
          limit: 15,
        });
        const names = new Set<string>();
        for (const r of related) {
          if (r.uploader && r.uploader.toLowerCase() !== lower) names.add(r.uploader);
          if (names.size >= 8) break;
        }
        if (names.size > 0) return [...names];
      }
    } catch {}
    try {
      const users = await invoke<ScUserResult[]>("sc_search_users", { query: artist, limit: 10 });
      const names = new Set<string>();
      for (const u of users) {
        if (u.username && u.username !== artist) names.add(u.username);
      }
      if (names.size > 0) return [...names].slice(0, 8);
    } catch {}
    const results = await this.searchEntries(artist, 10);
    const names = new Set<string>();
    for (const r of results) {
      if (r.uploader && r.uploader !== artist) names.add(r.uploader);
    }
    return [...names].slice(0, 8);
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    // Топ — это треки самого артиста (точное совпадение uploader),
    // а не похожие треки: переиспользуем getArtist.
    try {
      const detail = await this.getArtist(`soundcloud:artist:${encodeURIComponent(artist)}`);
      if (detail.topTracks.length > 0) return detail.topTracks;
    } catch {}
    return this.getSimilarTracks(artist, "");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("soundcloud provider: no albums");
  }

  async getArtist(artistId: string): Promise<ArtistDetail> {
    const name = decodeURIComponent(artistId.replace("soundcloud:artist:", ""));
    if (!name) throw new Error("soundcloud: no artist name in id");

    const entries = await this.searchEntries(name, 20);
    const tracks: Track[] = entries
      .filter((e) => e.uploader && e.uploader.toLowerCase() === name.toLowerCase())
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

    const coverUrl = tracks[0]?.coverUrl;

    return {
      artist: { id: artistId, provider: this.id, name, coverUrl },
      topTracks: tracks.slice(0, 15),
      albums: [],
    };
  }
}
