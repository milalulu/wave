import { withDeadline } from "../core/util/deadline";
import type { Track } from "../core/types";
import {
  assembleArtistStation,
  normalizeArtistName,
  type ArtistRadioStation,
} from "../core/radio/artistRadio";
import { radioTracks, type AppServices } from "./compose";
import { isArtistBlocked, isTrackBlocked } from "./platformSettings";

const STATION_LIMIT = 20;

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const key = s.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

/**
 * Строит радиостанцию по артисту:
 * 1) топ-треки артиста + похожие артисты (параллельно),
 * 2) похожесть через существующий radioTracks (ranked + resolved),
 * 3) дотягиваем топами похожих артистов,
 * 4) финальная сборка через assembleArtistStation.
 */
export async function buildArtistRadioStation(
  services: AppServices,
  rawArtist: string,
  limit = STATION_LIMIT,
  signal?: AbortSignal,
): Promise<ArtistRadioStation> {
  const artist = normalizeArtistName(rawArtist);
  if (!artist) throw new Error("artist required");

  if (signal?.aborted) throw new Error("Request cancelled");
  const providers = services.providers;
  const bounded = <T>(promise: Promise<T>) => withDeadline(promise, 10_000, signal);

  const [topTracksSettled, similarArtistsSettled] = await Promise.all([
    Promise.allSettled(
      providers
        .filter((p) => typeof p.getArtistTopTracks === "function")
        .map((p) => bounded(p.getArtistTopTracks!(artist))),
    ),
    Promise.allSettled(
      providers
        .filter((p) => typeof p.getSimilarArtists === "function")
        .map((p) => bounded(p.getSimilarArtists!(artist))),
    ),
  ]);

  if (signal?.aborted) throw new Error("Request cancelled");
  const topTracks: Track[] = [];
  const seedIds: string[] = [];
  for (const r of topTracksSettled) {
    if (r.status !== "fulfilled") continue;
    for (const tr of r.value) {
      if (!tr.title) continue;
      if (isTrackBlocked(tr.id) || isArtistBlocked(tr.artist)) continue;
      topTracks.push(tr);
      if (seedIds.length < 8) seedIds.push(tr.id);
    }
  }

  const similarArtists = dedupeStrings(
    similarArtistsSettled.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    ),
  )
    .filter((a) => a.toLowerCase() !== artist.toLowerCase())
    .slice(0, 8);

  // Похожесть через проверенный путь radioTracks: берём до 2 сидов из топа,
  // плюс виртуальный сид артиста как фолбэк.
  const seedPool: Track[] =
    topTracks.length > 0
      ? topTracks.slice(0, 2)
      : [
          {
            id: `artist-radio:${artist.toLowerCase()}`,
            provider: "radio",
            uri: "",
            title: "",
            artist,
          },
        ];

  const radioParts = await Promise.allSettled(
    seedPool.map((seed) => bounded(radioTracks(services, seed))),
  );
  let candidates: Track[] = radioParts.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );

  if (signal?.aborted) throw new Error("Request cancelled");

  // Если похожести мало — дотягиваем топами похожих артистов (до 3).
  if (candidates.length < 8 && similarArtists.length > 0) {
    const extra = await Promise.allSettled(
      similarArtists
        .slice(0, 3)
        .flatMap((name) =>
          providers
            .filter((p) => typeof p.getArtistTopTracks === "function")
            .map((p) => bounded(p.getArtistTopTracks!(name))),
        ),
    );
    for (const r of extra) {
      if (r.status !== "fulfilled") continue;
      for (const tr of r.value.slice(0, 4)) {
        if (isTrackBlocked(tr.id) || isArtistBlocked(tr.artist)) continue;
        candidates.push(tr);
      }
    }
  }

  if (signal?.aborted) throw new Error("Request cancelled");

  // Всегда подмешиваем топ самого артиста, чтобы станция не уплывала.
  candidates = [...topTracks.slice(0, 6), ...candidates];

  const filtered = candidates.filter(
    (tr) => !isTrackBlocked(tr.id) && !isArtistBlocked(tr.artist),
  );

  const station = assembleArtistStation(
    artist,
    filtered,
    similarArtists,
    seedIds,
    limit,
  );

  // similarArtists мог прийти пустым (нет провайдера) — пробуем добрать
  // из артистов выдачи.
  if (station.similarArtists.length === 0) {
    const fromTracks = dedupeStrings(
      station.tracks.map((tr) => tr.artist ?? "").filter(Boolean),
    )
      .filter((a) => a.toLowerCase() !== artist.toLowerCase())
      .slice(0, 8);
    return { ...station, similarArtists: fromTracks };
  }

  return station;
}

export type { ArtistRadioStation };

/** Continue from the current song without replaying items already in this queue. */
export async function nextArtistRadioTracks(
  services: AppServices,
  station: ArtistRadioStation,
): Promise<Track[]> {
  const current = services.engine.snapshot.current;
  if (!current) return [];
  const identity = (track: Track) => `${track.artist ?? ""}\0${track.title}`.toLowerCase().replace(/\s+/g, " ").trim();
  const queued = new Set(services.engine.snapshot.queue.map(identity));
  const related = await withDeadline(radioTracks(services, current), 10_000);
  return assembleArtistStation(
    station.artist,
    related.filter((track) => !queued.has(identity(track))),
    station.similarArtists,
  ).tracks;
}
