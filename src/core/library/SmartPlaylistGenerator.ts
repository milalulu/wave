import type { HistoryEntry, Track } from "../types";

export type SmartPlaylistType =
  | "mostPlayed"
  | "recentlyPlayed"
  | "genreMix"
  | "deepCuts"
  | "freshDiscoveries";

export interface SmartPlaylist {
  type: SmartPlaylistType;
  nameKey: string;
  descKey: string;
  tracks: Track[];
  icon: string;
}

const DAY_MS = 86_400_000;
const DEEP_CUT_THRESHOLD = 30;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dedupById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function buildTrackCounts(history: HistoryEntry[]): Map<string, { count: number; track: Track }> {
  const map = new Map<string, { count: number; track: Track }>();
  for (const e of history) {
    const prev = map.get(e.track.id);
    if (prev) prev.count++;
    else map.set(e.track.id, { count: 1, track: e.track });
  }
  return map;
}

function buildGenreMap(history: HistoryEntry[]): Map<string, Track[]> {
  const map = new Map<string, Track[]>();
  for (const e of history) {
    const genre = e.track.genre;
    if (!genre) continue;
    const arr = map.get(genre) ?? [];
    if (!arr.some((t) => t.id === e.track.id)) arr.push(e.track);
    map.set(genre, arr);
  }
  return map;
}

function buildArtistMap(history: HistoryEntry[]): Map<string, Track[]> {
  const map = new Map<string, Track[]>();
  for (const e of history) {
    const artist = e.track.artist;
    if (!artist) continue;
    const arr = map.get(artist) ?? [];
    if (arr.length === 0 || !arr.some((t) => t.id === e.track.id)) arr.push(e.track);
    map.set(artist, arr);
  }
  return map;
}

function getMostPlayed(history: HistoryEntry[]): Track[] {
  const counts = buildTrackCounts(history);
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((e) => e.track);
}

function getRecentlyPlayed(history: HistoryEntry[]): Track[] {
  const sorted = [...history].sort((a, b) => b.playedAt - a.playedAt);
  return dedupById(sorted.map((e) => e.track)).slice(0, 20);
}

function getGenreMix(history: HistoryEntry[]): Track[] {
  const genreMap = buildGenreMap(history);
  const topGenres = [...genreMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);
  const result: Track[] = [];
  for (const [, tracks] of topGenres) {
    result.push(...shuffle(tracks).slice(0, 7));
  }
  return shuffle(result).slice(0, 20);
}

function getDeepCuts(history: HistoryEntry[], likedTracks: Track[]): Track[] {
  const recentIds = new Set<string>();
  const threshold = Date.now() - DEEP_CUT_THRESHOLD * DAY_MS;
  for (const e of history) {
    if (e.playedAt >= threshold) recentIds.add(e.track.id);
  }
  return shuffle(likedTracks.filter((t) => !recentIds.has(t.id))).slice(0, 20);
}

function getFreshDiscoveries(history: HistoryEntry[]): Track[] {
  const artistMap = buildArtistMap(history);
  const entries = [...artistMap.entries()].sort((a, b) => b[1].length - a[1].length);
  const result: Track[] = [];
  for (const [, tracks] of entries) {
    result.push(tracks[Math.floor(Math.random() * tracks.length)]);
    if (result.length >= 20) break;
  }
  return shuffle(result);
}

export function generateSmartPlaylists(
  history: HistoryEntry[],
  likedTracks: Track[],
): SmartPlaylist[] {
  if (history.length === 0 && likedTracks.length === 0) return [];

  const playlists: SmartPlaylist[] = [];

  if (history.length >= 5) {
    playlists.push({
      type: "mostPlayed",
      nameKey: "mostPlayed",
      descKey: "mostPlayedDesc",
      tracks: getMostPlayed(history),
      icon: "🔥",
    });
    playlists.push({
      type: "recentlyPlayed",
      nameKey: "recentlyPlayed",
      descKey: "recentlyPlayedDesc",
      tracks: getRecentlyPlayed(history),
      icon: "🕐",
    });
    const genreMix = getGenreMix(history);
    if (genreMix.length > 0) {
      playlists.push({
        type: "genreMix",
        nameKey: "genreMix",
        descKey: "genreMixDesc",
        tracks: genreMix,
        icon: "🎸",
      });
    }
    playlists.push({
      type: "freshDiscoveries",
      nameKey: "freshDiscoveries",
      descKey: "freshDiscoveriesDesc",
      tracks: getFreshDiscoveries(history),
      icon: "✨",
    });
  }

  if (likedTracks.length >= 5) {
    const deepCuts = getDeepCuts(history, likedTracks);
    if (deepCuts.length > 0) {
      playlists.push({
        type: "deepCuts",
        nameKey: "deepCuts",
        descKey: "deepCutsDesc",
        tracks: deepCuts,
        icon: "💎",
      });
    }
  }

  return playlists;
}
