import type { HttpJsonGateway } from "../providers/HttpGateway";
import type { Track } from "../types";

export interface LyricsLine {
  
  time?: number;
  text: string;
}

export interface LyricsResult {
  trackId: string;
  title: string;
  artist?: string;
  synced: boolean;
  instrumental: boolean;
  source: string;
  lines: LyricsLine[];
}

interface LrclibHit {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

const API = "https://lrclib.net";
const UA = "Wave/0.1 (music client; https://github.com/velvett/wave)";

export function parseSyncedLyrics(lrc: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const tags: number[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(raw))) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracRaw = m[3] ?? "0";
      const frac = Number(fracRaw.padEnd(3, "0").slice(0, 3)) / 1000;
      tags.push(min * 60 + sec + frac);
    }
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (tags.length === 0 || !text) continue;
    for (const t of tags) lines.push({ time: t, text });
  }
  return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

export class LyricsService {
  private cache = new Map<string, LyricsResult>();
  private readonly cacheLimit = 40;

  constructor(
    private http: HttpJsonGateway,
  ) {}

  async getLyrics(track: Track): Promise<LyricsResult> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;    let result: LyricsResult | null;
    try {
      result = await this.fetch(track);
    } catch {
      result = null;
    }
    result ??= this.empty(track);
    this.cache.set(track.id, result);
    if (this.cache.size > this.cacheLimit) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return result;
  }

  
  invalidate(trackId: string): void {
    this.cache.delete(trackId);
  }

  
  clearCache(): void {
    this.cache.clear();
  }

  private empty(track: Track): LyricsResult {
    return {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      synced: false,
      instrumental: false,
      source: "lrclib",
      lines: [],
    };
  }

  private async fetch(track: Track): Promise<LyricsResult | null> {
    const params = new URLSearchParams();
    if (track.title) params.set("track_name", track.title);
    if (track.artist) params.set("artist_name", track.artist);
    if (track.album) params.set("album_name", track.album);
    if (track.duration && track.duration > 0) {
      params.set("duration", String(Math.round(track.duration)));
    }
    const direct = await this.http.json("GET", `${API}/api/get?${params.toString()}`, undefined, {
      "User-Agent": UA,
    });
    if (direct.status === 200) {
      const hit = direct.body as LrclibHit;
      if (hit.syncedLyrics || hit.plainLyrics) return this.toResult(track, hit);
    }

    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const search = await this.http.json(
      "GET",
      `${API}/api/search?q=${encodeURIComponent(query)}`,
      undefined,
      { "User-Agent": UA },
    );
    if (search.status !== 200) return null;
    const hits = ((search.body as LrclibHit[]) ?? []).filter(
      (h) => h.syncedLyrics || h.plainLyrics,
    );
    const best = pickBest(hits, track);
    return best ? this.toResult(track, best) : null;
  }

  private toResult(track: Track, hit: LrclibHit): LyricsResult {
    const syncedRaw = hit.syncedLyrics?.trim();
    if (syncedRaw) {
      return {
        trackId: track.id,
        title: hit.trackName ?? track.title,
        artist: hit.artistName ?? track.artist,
        synced: true,
        instrumental: !!hit.instrumental,
        source: "lrclib",
        lines: parseSyncedLyrics(syncedRaw),
      };
    }
    const plain = hit.plainLyrics?.trim();
    return {
      trackId: track.id,
      title: hit.trackName ?? track.title,
      artist: hit.artistName ?? track.artist,
      synced: false,
      instrumental: !!hit.instrumental,
      source: "lrclib",
      lines: plain ? plain.split(/\r?\n/).map((text) => ({ text })) : [],
    };
  }

}

function norm(s?: string): string {
  return (s ?? "").trim().toLocaleLowerCase();
}

function pickBest(hits: LrclibHit[], track: Track): LrclibHit | null {
  let best: LrclibHit | null = null;
  let bestScore = -1;
  for (const h of hits) {
    let score = 0;
    const hitTitle = norm(h.trackName);
    const hitArtist = norm(h.artistName);
    const title = norm(track.title);
    const artist = norm(track.artist);
    if (hitTitle && title) {
      if (hitTitle === title) score += 3;
      else if (title.includes(hitTitle) || hitTitle.includes(title)) score += 1;
    }
    if (hitArtist && artist && hitArtist === artist) score += 2;
    if (h.syncedLyrics) score += 1;
    if (track.duration && h.duration) {
      const diff = Math.abs(h.duration - track.duration);
      if (diff <= 3) score += 2;
      else if (diff <= 10) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}
