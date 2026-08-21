import type { Album, Artist, SearchResults, Track } from "../types";

const FULL_PLAYBACK = new Set(["youtube", "soundcloud"]);

const NOISE_RE = /\[([^\]]*)\]|\(([^\)]*)\)|\{([^\}]*)\}/g;
const EXTRA_NOISE = [
  /official\s+(video|audio|music\s+video|lyric\s+video|visualizer|performance)/i,
  /official/i,
  /\blive\s*(at|from|performance|session|concert|on\b)/i,
  /\b(acoustic|unplugged|stripped|session|demo|rehearsal)\b/i,
  /\b(remastered|remaster|remix|extended|edit|version|mix|radio\s+edit|club\s+edit|single|deluxe|anniversary|edition|clean|explicit|sped\s*(up|down)|slowed|nightcore)\b/i,
  /\b(remasterizado|reedicion|reedición|en\s+directo|en\s+vivo)\b/i,
  /\b(mp3|hd|4k|uhd|1080p|720p|audio\s+only)\b/i,
  /\b(cover\s*art|artwork|visual|art)\b/i,
  /\b(music|lyric|video)\b/i,
];
const SEPARATOR_RE = /\s*[-–—:]\s*/;

let normalizeCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  return normalizeCache.get(key);
}
function cacheSet(key: string, val: string): string {
  if (normalizeCache.size > 2000) normalizeCache.clear();
  normalizeCache.set(key, val);
  return val;
}

export function normalizeTitle(raw: string): string {
  const cached = cacheGet(`t:${raw}`);
  if (cached !== undefined) return cached;

  let s = raw;

  s = s.replace(NOISE_RE, (_match, b1, b2, b3) => {
    const inner = (b1 ?? b2 ?? b3 ?? "").trim();
    for (const re of EXTRA_NOISE) {
      if (re.test(inner)) return " ";
    }
    return " ";
  });

  s = s.replace(/[""«»„"]/g, "");
  s = s.replace(/[,;!?¡¿.]+/g, " ");

  const parts = s.split(SEPARATOR_RE).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim().toLowerCase();
    const channelPattern =
      /^(official|vevo|topic|music|lyrics|audio|video|official\s+topic|records?|entertainment)\s*$/;
    if (channelPattern.test(last)) {
      parts.pop();
    } else if (/\b(vevo|topic)\b/i.test(last)) {
      parts.pop();
    }
  }

  s = parts.join(" ");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();

  return cacheSet(`t:${raw}`, s);
}

export function normalizeArtist(raw: string): string {
  const cached = cacheGet(`a:${raw}`);
  if (cached !== undefined) return cached;

  let s = raw
    .replace(/\s*[-–—]\s*(topic|vevo|official|music|entertainment|topic\s+records?|topic\s+music|official\s+topic)\s*$/i, "")
    .replace(/\s+(topic|vevo)\s*$/i, "")
    .replace(/\s*\(topic\)\s*$/i, "")
    .replace(/[""«»„"]/g, "")
    .replace(/[,;!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return cacheSet(`a:${raw}`, s);
}

function trackKey(t: Track): string {
  const artist = normalizeArtist(t.artist ?? "");
  const title = normalizeTitle(t.title);
  if (!artist && !title) return "";
  return `${artist}|||${title}`;
}

function albumKey(a: Album): string {
  const artist = normalizeArtist(a.artist ?? "");
  const title = normalizeTitle(a.title);
  return `${artist}|||${title}`;
}

function artistKey(a: Artist): string {
  return normalizeArtist(a.name);
}

function trackScore(t: Track, queryNorm: string): number {
  let score = 0;

  const titleNorm = normalizeTitle(t.title);
  const artistNorm = normalizeArtist(t.artist ?? "");
  const queryWords = queryNorm.split(/\s+/).filter(Boolean);

  if (titleNorm === queryNorm) score += 100;
  else if (titleNorm.startsWith(queryNorm)) score += 80;
  else if (queryNorm.startsWith(titleNorm)) score += 70;
  else {
    const matched = queryWords.filter((w) => titleNorm.includes(w)).length;
    score += Math.round((matched / queryWords.length) * 50);
  }

  if (artistNorm && queryWords.some((w) => artistNorm.includes(w))) {
    score += 20;
  }

  if (FULL_PLAYBACK.has(t.provider)) score += 15;
  else if (t.meta?.preview) score -= 10;

  if (t.duration && t.duration > 60) score += 5;
  if (t.coverUrl) score += 3;

  const searchIdx = (t.meta?.searchIndex as number | undefined) ?? 0;
  score += Math.max(0, 10 - searchIdx);

  return score;
}

function isFullPlayback(t: Track): boolean {
  return FULL_PLAYBACK.has(t.provider);
}

function pickBestTrack(group: Track[], queryNorm: string): Track {
  const full = group.filter(isFullPlayback);
  const pool = full.length > 0 ? full : group;

  let best = pool[0];
  let bestScore = -Infinity;
  for (const t of pool) {
    const s = trackScore(t, queryNorm);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }

  const altTracks = group.filter((t) => t.id !== best.id);
  if (altTracks.length > 0) {
    best = { ...best };
    best.meta = {
      ...best.meta,
      alternatives: altTracks.map((t) => ({
        id: t.id,
        provider: t.provider,
        uri: t.uri,
      })),
    };
  }

  return best;
}

function pickBestAlbum(group: Album[]): Album {
  let best = group[0];
  for (const a of group) {
    if (a.coverUrl && !best.coverUrl) best = a;
    if (a.trackCount && (!best.trackCount || a.trackCount > best.trackCount)) best = a;
  }
  return best;
}

function pickBestArtist(group: Artist[]): Artist {
  let best = group[0];
  for (const a of group) {
    if (a.coverUrl && !best.coverUrl) best = a;
  }
  return best;
}

function deduplicateTracks(tracks: Track[], queryNorm: string): Track[] {
  const groups = new Map<string, Track[]>();
  const order = new Map<string, number>();
  let idx = 0;

  for (const t of tracks) {
    const key = trackKey(t);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.set(key, idx++);
    }
    group.push(t);
  }

  const result: { track: Track; order: number }[] = [];
  for (const [key, group] of groups) {
    result.push({ track: pickBestTrack(group, queryNorm), order: order.get(key) ?? 0 });
  }

  result.sort((a, b) => {
    const scoreDiff = trackScore(b.track, queryNorm) - trackScore(a.track, queryNorm);
    if (Math.abs(scoreDiff) > 5) return scoreDiff;
    return a.order - b.order;
  });

  return result.map((r) => r.track);
}

function deduplicateAlbums(albums: Album[]): Album[] {
  const groups = new Map<string, Album[]>();
  const order = new Map<string, number>();
  let idx = 0;

  for (const a of albums) {
    const key = albumKey(a);
    if (!key || key === "|||") continue;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.set(key, idx++);
    }
    group.push(a);
  }

  const result: { album: Album; order: number }[] = [];
  for (const [key, group] of groups) {
    result.push({ album: pickBestAlbum(group), order: order.get(key) ?? 0 });
  }

  result.sort((a, b) => a.order - b.order);
  return result.map((r) => r.album);
}

function deduplicateArtists(artists: Artist[]): Artist[] {
  const groups = new Map<string, Artist[]>();
  const order = new Map<string, number>();
  let idx = 0;

  for (const a of artists) {
    const key = artistKey(a);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.set(key, idx++);
    }
    group.push(a);
  }

  const result: { artist: Artist; order: number }[] = [];
  for (const [, group] of groups) {
    result.push({ artist: pickBestArtist(group), order: order.get(group[0].id) ?? 0 });
  }

  result.sort((a, b) => a.order - b.order);
  return result.map((r) => r.artist);
}

function rankAlbums(albums: Album[], queryNorm: string): Album[] {
  const scored = albums.map((a) => {
    const titleNorm = normalizeTitle(a.title);
    let score = 0;
    if (titleNorm === queryNorm) score += 100;
    else if (titleNorm.startsWith(queryNorm)) score += 70;
    else if (queryNorm.startsWith(titleNorm)) score += 60;
    else {
      const words = queryNorm.split(/\s+/).filter(Boolean);
      score += Math.round(
        (words.filter((w) => titleNorm.includes(w)).length / words.length) * 40,
      );
    }
    if (a.coverUrl) score += 5;
    return { album: a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.album);
}

function rankArtists(artists: Artist[], queryNorm: string): Artist[] {
  const scored = artists.map((a) => {
    const nameNorm = normalizeArtist(a.name);
    let score = 0;
    if (nameNorm === queryNorm) score += 100;
    else if (nameNorm.startsWith(queryNorm)) score += 70;
    else if (queryNorm.startsWith(nameNorm)) score += 60;
    else {
      const words = queryNorm.split(/\s+/).filter(Boolean);
      score += Math.round(
        (words.filter((w) => nameNorm.includes(w)).length / words.length) * 40,
      );
    }
    if (a.coverUrl) score += 5;
    return { artist: a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.artist);
}

export function normalizeSearchResults(
  allResults: SearchResults[],
  query: string,
): SearchResults[] {
  const queryNorm = normalizeTitle(query);

  const allTracks = allResults.flatMap((r) => r.tracks);
  const allAlbums = allResults.flatMap((r) => r.albums);
  const allArtists = allResults.flatMap((r) => r.artists);

  const tracks = rankTracks(deduplicateTracks(allTracks, queryNorm), queryNorm);
  const albums = rankAlbums(deduplicateAlbums(allAlbums), queryNorm);
  const artists = rankArtists(deduplicateArtists(allArtists), queryNorm);

  if (tracks.length === 0 && albums.length === 0 && artists.length === 0) {
    return allResults;
  }

  return [{ provider: "merged", tracks, albums, artists }];
}

export function rankTracks(tracks: Track[], query: string): Track[] {
  const queryNorm = normalizeTitle(query);
  return [...tracks].sort((a, b) => {
    const sa = trackScore(a, queryNorm);
    const sb = trackScore(b, queryNorm);
    return sb - sa;
  });
}
