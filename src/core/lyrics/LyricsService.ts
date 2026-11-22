import type { HttpJsonGateway } from "../providers/HttpGateway";
import type { Track } from "../types";
import { sameRecording } from "../recordings/matching";

export interface LyricsLine {
  time?: number;
  text: string;
  words?: { text: string; time: number; end?: number }[];
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
  hasWordSync?: boolean;
  lyricsfile?: string | null;
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
    const content = raw.replace(/\[[^\]]*\]/g, "").trim();
    const wordTag = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
    const markers = [...content.matchAll(wordTag)];
    const text = content.replace(wordTag, "").trim();
    if (tags.length === 0 || !text) continue;
    const timed = markers.map((marker, index) => {
      const next = markers[index + 1];
      const time = Number(marker[1]) * 60 + Number(marker[2]) + Number((marker[3] ?? "").padEnd(3, "0")) / 1000;
      return { time, text: content.slice(marker.index + marker[0].length, next?.index) };
    });
    const ordered = timed.every((word, index) => index === 0 || word.time > timed[index - 1].time);
    const words = markers[0]?.index === 0 && ordered
      ? timed.flatMap((word, index) => word.text ? [{ ...word, end: timed[index + 1]?.time }] : [])
      : [];
    for (const t of tags) {
      lines.push({ time: t, text, ...(tags.length === 1 && words.length && words[0].time >= t ? { words } : {}) });
    }
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

async function parseWordSyncedLyricsFile(raw: string): Promise<LyricsLine[]> {
  if (raw.length > 256 * 1024) return [];
  try {
    const { parseDocument } = await import("yaml");
    const document = parseDocument(raw, { logLevel: "silent" });
    if (document.errors.length) return [];
    const data = document.toJS({ maxAliasCount: 0 });
    if (!Array.isArray(data?.lines)) return [];
    const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value / 1000 : undefined;
    const lines: LyricsLine[] = [];
    for (const line of data.lines) {
      if (typeof line?.text !== "string" || !line.text.trim()) continue;
      const text = line.text.trim();
      const time = seconds(line.start_ms) ?? seconds(line.words?.[0]?.start_ms);
      if (time === undefined) continue;
      let offset = 0;
      const words: NonNullable<LyricsLine["words"]> = [];
      for (const word of Array.isArray(line.words) ? line.words : []) {
        const token = typeof word?.text === "string" ? word.text.trim() : "";
        const start = seconds(word?.start_ms);
        const nextOffset = text.indexOf(token, offset);
        const previous = words[words.length - 1];
        if (!token || start === undefined || start < time || start < (previous?.time ?? time)
            || nextOffset < 0 || text.slice(offset, nextOffset).trim()) break;
        if (previous && previous.end === undefined) previous.end = start;
        const end = seconds(word.end_ms);
        words.push({ text: text.slice(offset, nextOffset + token.length), time: start, end });
        offset = nextOffset + token.length;
      }
      const last = words[words.length - 1];
      if (last && last.end === undefined) last.end = seconds(line.end_ms);
      lines.push({ text, time, ...(words.length && offset === text.length ? { words } : {}) });
    }
    return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  } catch {
    return [];
  }
}

export class LyricsService {
  private cache = new Map<string, LyricsResult>();
  private readonly cacheLimit = 40;

  constructor(
    private http: HttpJsonGateway,
    private findRecordingVariants?: (track: Track) => Promise<Track[]>,
  ) {}

  async getLyrics(track: Track): Promise<LyricsResult> {
    try {
      const raw = localStorage.getItem(this.localKey(track.id));
      if (raw) {
        const imported = this.parseLocalLyrics(track, raw);
        if (imported.lines.length) return imported;
      }
    } catch {}
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    let result: LyricsResult | null;
    try {
      result = await this.fetch(track);
    } catch {
      result = null;
    }
    result ??= this.empty(track);
    if (!result.instrumental && result.lines.length === 0) return result;
    this.cache.set(track.id, result);
    if (this.cache.size > this.cacheLimit) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return result;
  }

  importLocalLyrics(track: Track, raw: string): void {
    if (raw.length > 128 * 1024 || !this.parseLocalLyrics(track, raw).lines.length) {
      throw new Error("Invalid lyrics file");
    }
    localStorage.setItem(this.localKey(track.id), raw);
  }

  private localKey(id: string): string {
    return `wave:lyrics:${id}`;
  }

  private parseLocalLyrics(track: Track, raw: string): LyricsResult {
    const sync = parseSyncedLyrics(raw);
    return {
      ...this.empty(track),
      source: "local",
      synced: sync.length > 0,
      lines: sync.length ? sync : parsePlainLyrics(raw),
    };
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
      () => this.fetchVariantLyrics(track),
      () => this.fetchNetease(track),
      () => this.fetchQQ(track),
      () => this.fetchMegalobiz(track),
    ];

    for (const fetch of sources) {
      try {
        const result = await fetch();
        if (result?.instrumental || result?.lines.length) return result;
      } catch (e) {
        console.debug("[lyrics] source failed:", e);
      }
    }
    return null;
  }

  private async fetchVariantLyrics(track: Track): Promise<LyricsResult | null> {
    const duration = track.duration;
    if (!this.findRecordingVariants || !duration || duration <= 0) return null;
    const signature = cleanMetadata(track);
    const candidates = await this.findRecordingVariants(signature);
    const match = candidates.find((candidate) => candidate.provider !== track.provider
      && candidate.duration && Math.abs(candidate.duration - duration) <= 3
      && sameRecording(signature, cleanMetadata(candidate)));
    if (!match) return null;
    const result = await this.fetchLrclib(match);
    return result ? { ...result, trackId: track.id } : null;
  }

  private async fetchLrclib(track: Track): Promise<LyricsResult | null> {
    const lookup = cleanMetadata(track);
    const params = new URLSearchParams();
    if (lookup.title) params.set("track_name", lookup.title);
    if (lookup.artist) params.set("artist_name", lookup.artist);
    if (track.album) params.set("album_name", track.album);
    if (track.duration && track.duration > 0) {
      params.set("duration", String(Math.round(track.duration)));
    }
    const direct = await this.http.json("GET", `${LRCLIB_API}/api/get?${params.toString()}`, undefined, {
      "User-Agent": UA,
    });
    if (direct.status === 200) {
      const hit = direct.body as LrclibHit;
      if (hit && pickBest([hit], lookup)) return this.toResult(track, hit, "lrclib");
    }

    if (!lookup.title) return null;
    const search = async (candidate: Track, requireDuration = false) => {
      const params = new URLSearchParams({ track_name: candidate.title });
      if (candidate.artist) params.set("artist_name", candidate.artist);
      const response = await this.http.json("GET", `${LRCLIB_API}/api/search?${params}`, undefined, { "User-Agent": UA });
      if (response.status !== 200 || !Array.isArray(response.body)) return null;
      return pickBest(response.body as LrclibHit[], candidate, requireDuration);
    };
    let best = await search(lookup);
    // Reuploads often credit the uploader in metadata and the artist in the title.
    const credited = /^(.+?)\s+[-–—]+\s+(.+)$/.exec(lookup.title);
    if (!best && credited && (track.duration ?? 0) > 0) {
      best = await search({ ...lookup, artist: credited[1], title: credited[2] }, true);
    }
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

  private async toResult(track: Track, hit: LrclibHit, source: string): Promise<LyricsResult> {
    const wordLines = hit.hasWordSync && typeof hit.lyricsfile === "string"
      ? await parseWordSyncedLyricsFile(hit.lyricsfile) : [];
    const syncedRaw = hit.syncedLyrics?.trim();
    if (wordLines.length || syncedRaw) {
      return {
        trackId: track.id,
        title: hit.trackName ?? track.title,
        artist: hit.artistName ?? track.artist,
        synced: true,
        instrumental: !!hit.instrumental,
        source,
        lines: wordLines.length ? wordLines : parseSyncedLyrics(syncedRaw ?? ""),
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
  return (s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cleanMetadata(track: Track): Track {
  let title = track.title
    .replace(/\s*[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|lyric(?:s| video)?|visualizer)\s*[)\]]/gi, "")
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?)\s+[^()[\]]+[)\]]/gi, "")
    .replace(/\s+(?:feat\.?|ft\.?)\s+[^()[\]]+$/i, "")
    .trim();
  let artist = track.artist?.replace(/\s*(?:[-–—]\s*Topic|VEVO)$/i, "").trim();
  const parts = /^(.+?)\s+[-–—]+\s+(.+)$/.exec(title);
  if (parts && (!artist || norm(parts[1]) === norm(artist))) {
    artist ||= parts[1];
    title = parts[2];
  }
  return { ...track, title, artist };
}

function pickBest(hits: LrclibHit[], track: Track, requireDuration = false): LrclibHit | null {
  let best: LrclibHit | null = null;
  let bestScore = -Infinity;
  const title = norm(track.title);
  const artist = norm(track.artist);
  for (const hit of hits) {
    if (!hit || !(hit.syncedLyrics || hit.plainLyrics || hit.instrumental || (hit.hasWordSync && hit.lyricsfile))) continue;
    const credited = cleanMetadata({ ...track, title: hit.trackName ?? "", artist: hit.artistName });
    if (!title || norm(credited.title) !== title) continue;
    if (artist && norm(credited.artist) !== artist) continue;
    const difference = track.duration && hit.duration ? Math.abs(track.duration - hit.duration) : undefined;
    if ((!artist || requireDuration) && (difference === undefined || difference > 3)) continue;
    if (difference !== undefined && difference > 6) continue;
    const score = (hit.hasWordSync ? 8 : hit.syncedLyrics ? 6 : 0) - (difference ?? 3)
      + (track.album && norm(track.album) === norm(hit.albumName) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }
  return best;
}
