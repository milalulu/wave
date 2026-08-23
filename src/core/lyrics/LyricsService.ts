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

interface NeteaseLyricsResponse {
  code: number;
  lyric?: {
    lyric: string;
  };
  tlyric?: {
    lyric: string;
  };
  romalrc?: {
    lyric: string;
  };
}

interface QQLyricsResponse {
  code: number;
  lyric?: string;
  trans?: string;
  roma?: string;
}

const LRCLIB_API = "https://lrclib.net";
const NETEASE_API = "https://music.163.com/api/song/lyric";
const QQ_API = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";
const MEGALOBIZ_API = "https://www.megalobiz.com/api/lyrics";

const UA = "Wave/0.1.9 (music client; https://github.com/milalulu/wave)";

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

export function parsePlainLyrics(plain: string): LyricsLine[] {
  return plain
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ text }));
}

export class LyricsService {
  private cache = new Map<string, LyricsResult>();
  private readonly cacheLimit = 40;

  constructor(
    private http: HttpJsonGateway,
  ) {}

  async getLyrics(track: Track): Promise<LyricsResult> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    let result: LyricsResult | null;
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
      source: "none",
      lines: [],
    };
  }

  private async fetch(track: Track): Promise<LyricsResult | null> {
    const sources = [
      () => this.fetchLrclib(track),
      () => this.fetchNetease(track),
      () => this.fetchQQ(track),
      () => this.fetchMegalobiz(track),
    ];

    for (const fetch of sources) {
      try {
        const result = await fetch();
        if (result) return result;
      } catch (e) {
        console.debug("[lyrics] source failed:", e);
      }
    }
    return null;
  }

  private async fetchLrclib(track: Track): Promise<LyricsResult | null> {
    const params = new URLSearchParams();
    if (track.title) params.set("track_name", track.title);
    if (track.artist) params.set("artist_name", track.artist);
    if (track.album) params.set("album_name", track.album);
    if (track.duration && track.duration > 0) {
      params.set("duration", String(Math.round(track.duration)));
    }
    const direct = await this.http.json("GET", `${LRCLIB_API}/api/get?${params.toString()}`, undefined, {
      "User-Agent": UA,
    });
    if (direct.status === 200) {
      const hit = direct.body as LrclibHit;
      if (hit.syncedLyrics || hit.plainLyrics) return this.toResult(track, hit, "lrclib");
    }

    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const search = await this.http.json(
      "GET",
      `${LRCLIB_API}/api/search?q=${encodeURIComponent(query)}`,
      undefined,
      { "User-Agent": UA },
    );
    if (search.status !== 200) return null;
    const hits = ((search.body as LrclibHit[]) ?? []).filter(
      (h) => h.syncedLyrics || h.plainLyrics,
    );
    const best = pickBest(hits, track);
    return best ? this.toResult(track, best, "lrclib") : null;
  }

  private async fetchNetease(track: Track): Promise<LyricsResult | null> {
    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const search = await this.http.json(
      "GET",
      `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&limit=1`,
      undefined,
      { "User-Agent": UA, Referer: "https://music.163.com/" },
    );
    if (search.status !== 200) return null;
    const songs = (search.body as { result?: { songs?: Array<{ id: number }> } })?.result?.songs;
    const songId = songs?.[0]?.id;
    if (!songId) return null;

    const lyricRes = await this.http.json(
      "GET",
      `${NETEASE_API}?id=${songId}&lv=1&kv=1&tv=-1`,
      undefined,
      { "User-Agent": UA, Referer: "https://music.163.com/" },
    );
    if (lyricRes.status !== 200) return null;
    const body = lyricRes.body as NeteaseLyricsResponse;
    if (body.code !== 200) return null;

    const synced = body.lyric?.lyric?.trim();
    if (synced) {
      return {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        synced: true,
        instrumental: false,
        source: "netease",
        lines: parseSyncedLyrics(synced),
      };
    }
    return null;
  }

  private async fetchQQ(track: Track): Promise<LyricsResult | null> {
    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const search = await this.http.json(
      "GET",
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?ct=24&qqmusic_ver=1298&new_json=1&remoteplace=txt.yqq.song&searchid=1&t=0&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&p=1&n=1&w=${encodeURIComponent(query)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      undefined,
      { "User-Agent": UA, Referer: "https://y.qq.com/" },
    );
    if (search.status !== 200) return null;
    const songMid = (search.body as { data?: { song?: { list?: Array<{ songmid: string }> } } })?.data?.song?.list?.[0]?.songmid;
    if (!songMid) return null;

    const lyricRes = await this.http.json(
      "GET",
      `${QQ_API}?songmid=${songMid}&format=json&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      undefined,
      { "User-Agent": UA, Referer: "https://y.qq.com/" },
    );
    if (lyricRes.status !== 200) return null;
    const body = lyricRes.body as QQLyricsResponse;
    if (body.code !== 0) return null;

    const synced = body.lyric?.trim();
    if (synced) {
      return {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        synced: true,
        instrumental: false,
        source: "qq",
        lines: parseSyncedLyrics(synced),
      };
    }
    return null;
  }

  private async fetchMegalobiz(track: Track): Promise<LyricsResult | null> {
    const query = [track.artist, track.title].filter(Boolean).join(" ");
    if (!query) return null;
    const res = await this.http.json(
      "GET",
      `${MEGALOBIZ_API}?q=${encodeURIComponent(query)}`,
      undefined,
      { "User-Agent": UA, Referer: "https://www.megalobiz.com/" },
    );
    if (res.status !== 200) return null;
    const hits = (res.body as Array<{ lyrics?: string; synced?: string }>) ?? [];
    const hit = hits[0];
    if (!hit) return null;

    const synced = hit.synced?.trim();
    if (synced) {
      return {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        synced: true,
        instrumental: false,
        source: "megalobiz",
        lines: parseSyncedLyrics(synced),
      };
    }
    const plain = hit.lyrics?.trim();
    if (plain) {
      return {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        synced: false,
        instrumental: false,
        source: "megalobiz",
        lines: parsePlainLyrics(plain),
      };
    }
    return null;
  }

  private toResult(track: Track, hit: LrclibHit, source: string): LyricsResult {
    const syncedRaw = hit.syncedLyrics?.trim();
    if (syncedRaw) {
      return {
        trackId: track.id,
        title: hit.trackName ?? track.title,
        artist: hit.artistName ?? track.artist,
        synced: true,
        instrumental: !!hit.instrumental,
        source,
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
      source,
      lines: plain ? parsePlainLyrics(plain) : [],
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