import type { HttpJsonGateway } from "../providers/HttpGateway";
import type { Track } from "../types";

export interface LyricsLine {
  /** Время в секундах (для синхронизированных), undefined для plain. */
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

interface GeniusHitResult {
  id?: number;
  title?: string;
  url?: string;
  primary_artist?: { name?: string };
}

interface GeniusSearchResponse {
  response?: { hits?: { result?: GeniusHitResult }[] };
}

const API = "https://lrclib.net";
const UA = "Wave/0.1 (music client; https://github.com/velvett/wave)";

/** Разбор синхронизированного LRC `[mm:ss.xx]text` в строки с таймингами. */
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

/** Клиент LRCLIB + Genius fallback: тексты песен, кэш на сессию. */
export class LyricsService {
  private cache = new Map<string, LyricsResult>();
  private readonly cacheLimit = 40;

  constructor(
    private http: HttpJsonGateway,
    private geniusToken?: string,
  ) {}

  async getLyrics(track: Track): Promise<LyricsResult> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    let result: LyricsResult | null = null;
    try {
      result = await this.fetch(track);
    } catch {
      result = null;
    }
    if (!result && this.geniusToken) {
      try {
        result = await this.fetchGenius(track);
      } catch {
        result = null;
      }
    }
    result ??= this.empty(track);
    this.cache.set(track.id, result);
    if (this.cache.size > this.cacheLimit) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return result;
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

  private async fetchGenius(track: Track): Promise<LyricsResult | null> {
    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const token = this.geniusToken;
    if (!token) return null;
    const { status, body } = await this.http.json(
      "GET",
      `https://api.genius.com/search?q=${encodeURIComponent(query)}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    if (status !== 200) return null;
    const hits = (body as GeniusSearchResponse)?.response?.hits ?? [];
    const best = pickBestGenius(hits, track);
    if (!best?.url || best.id === undefined) return null;
    const page = await this.http.text("GET", best.url);
    if (page.status !== 200) return null;
    const plain = extractGeniusLyrics(page.text);
    if (!plain) return null;
    return {
      trackId: track.id,
      title: best.title ?? track.title,
      artist: best.primary_artist?.name ?? track.artist,
      synced: false,
      instrumental: false,
      source: "genius",
      lines: plain.split(/\r?\n/).map((text) => ({ text })),
    };
  }
}

/** Извлечение текста из Genius-страницы (data-lyrics-container). */
export function extractGeniusLyrics(html: string): string {
  const parts: string[] = [];
  const re = /data-lyrics-container="true"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = html.indexOf(">", m.index);
    if (start < 0) continue;
    const end = html.indexOf("</div>", start);
    if (end < 0) continue;
    let seg = html.slice(start + 1, end);
    seg = seg.replace(/<br\s*\/?>/gi, "\n");
    seg = seg.replace(/<[^>]+>/g, "");
    seg = seg
      .replace(/&#39;|&apos;|&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    const text = seg
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
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

function pickBestGenius(hits: { result?: GeniusHitResult }[], track: Track): GeniusHitResult | null {
  let best: GeniusHitResult | null = null;
  let bestScore = -1;
  for (const h of hits) {
    const r = h.result;
    if (!r?.title) continue;
    let score = 0;
    const hitTitle = norm(r.title);
    const hitArtist = norm(r.primary_artist?.name);
    const title = norm(track.title);
    const artist = norm(track.artist);
    if (hitTitle && title) {
      if (hitTitle === title) score += 3;
      else if (title.includes(hitTitle) || hitTitle.includes(title)) score += 1;
    }
    if (hitArtist && artist && hitArtist === artist) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore > 0 ? best : null;
}
