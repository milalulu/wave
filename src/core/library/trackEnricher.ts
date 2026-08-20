import type { Track } from "../types";
import type { MusicBrainzProvider } from "../providers/MusicBrainzProvider";
import type { DeezerProvider } from "../providers/DeezerProvider";

export interface EnrichedMeta {
  bpm?: number;
  tags?: string[];
  popularity?: number;
}

const cache = new Map<string, { data: EnrichedMeta; at: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function trackKey(track: Track): string {
  return `${track.provider}:${track.id}`;
}

export async function enrichTrack(
  track: Track,
  mb: MusicBrainzProvider,
  dz: DeezerProvider,
): Promise<Track> {
  const key = trackKey(track);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    applyMeta(track, hit.data);
    return track;
  }

  const result: EnrichedMeta = {};

  const [mbResult, dzResult] = await Promise.allSettled([
    mb.getRecordingMeta(track.title, track.artist ?? ""),
    findDeezerBpm(track, dz),
  ]);

  if (mbResult.status === "fulfilled" && mbResult.value) {
    result.tags = mbResult.value.tags;
  }
  if (dzResult.status === "fulfilled" && dzResult.value) {
    result.bpm = dzResult.value.bpm;
    result.popularity = dzResult.value.popularity;
  }

  cache.set(key, { data: result, at: Date.now() });
  applyMeta(track, result);
  return track;
}

function applyMeta(track: Track, meta: EnrichedMeta): void {
  if (!track.meta) track.meta = {};
  if (meta.bpm && !track.meta.bpm) track.meta.bpm = meta.bpm;
  if (meta.tags && !track.meta.tags) track.meta.tags = meta.tags;
  if (meta.popularity !== undefined && !track.meta.popularity) {
    track.meta.popularity = meta.popularity;
  }
}

async function findDeezerBpm(
  track: Track,
  dz: DeezerProvider,
): Promise<{ bpm: number; popularity: number } | null> {
  if (track.provider === "deezer") {
    return dz.getTrackMeta(track.id);
  }
  const query = [track.artist, track.title].filter(Boolean).join(" ");
  if (!query) return null;
  try {
    const results = await dz.search(query);
    const match = results.tracks.find(
      (t) =>
        t.title?.toLowerCase() === track.title?.toLowerCase() &&
        t.artist?.toLowerCase() === track.artist?.toLowerCase(),
    );
    if (match) return dz.getTrackMeta(match.id);
  } catch {
    // ignore
  }
  return null;
}
