import type { Track } from "../types";
import { rankCandidates } from "../recommendations/rankCandidates";

export interface ArtistRadioStation {
  artist: string;
  tracks: Track[];
  similarArtists: string[];
  seedTrackIds: string[];
  generatedAt: number;
}

export function normalizeArtistName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function artistSeedTrack(artist: string): Track {
  const name = normalizeArtistName(artist);
  return {
    id: `artist-radio:${name.toLowerCase()}`,
    provider: "radio",
    uri: "",
    title: "",
    artist: name,
  };
}

/**
 * Чистая функция сборки станции: дедуп + ранжирование относительно
 * виртуального сида артиста. Сетевые запросы — снаружи, здесь только отбор.
 */
export function assembleArtistStation(
  artist: string,
  candidates: Track[],
  similarArtists: string[],
  seedTrackIds: string[] = [],
  limit = 20,
): ArtistRadioStation {
  const name = normalizeArtistName(artist);
  if (!name) throw new Error("artist required");
  const seed = artistSeedTrack(name);

  const playable = candidates.filter((track) =>
    !track.id.startsWith("artist-radio:") && track.title.trim() && track.uri && !track.meta?.noPlay,
  );
  const seenArtists = new Set([name.toLowerCase()]);
  const cleanSimilar = similarArtists.map(normalizeArtistName).filter((artist) => {
    const key = artist.toLowerCase();
    if (!key || seenArtists.has(key)) return false;
    seenArtists.add(key);
    return true;
  }).slice(0, 8);
  const taste = [...cleanSimilar.map(artistSeedTrack),
    ...seedTrackIds.map((id) => playable.find((track) => track.id === id) ?? { ...seed, id })];
  const tracks = rankCandidates(seed, playable, limit, { strict: true, taste });

  return {
    artist: name,
    tracks,
    similarArtists: cleanSimilar,
    seedTrackIds,
    generatedAt: Date.now(),
  };
}
