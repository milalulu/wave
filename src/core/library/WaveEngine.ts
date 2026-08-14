import type { HistoryEntry, Track } from "../types";
import type { Storage } from "../database/Storage";
import type { MusicProvider } from "../providers/MusicProvider";

export interface WaveContext {
  likedTracks: Track[];
  history: HistoryEntry[];
  libraryGenres: Map<string, number>;
  candidates: Track[];
  recentIds?: Set<string>;
}

export interface WaveSource {
  generate(limit: number, ctx: WaveContext): Track[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Взвешенная «волна»: лайки весят выше, недавно прослушанное затухает,
 * треки из топ-жанров библиотеки усиливаются. Расширяется до
 * полноценной рекомендательной машины через WaveSource.
 */
export class WeightedRandomWaveSource implements WaveSource {
  constructor(private rng: () => number = Math.random) {}

  generate(limit: number, ctx: WaveContext): Track[] {
    const pool = new Map<string, { track: Track; weight: number }>();
    const topGenres = [...ctx.libraryGenres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);
    const topGenreSet = new Set(topGenres);

    for (const track of ctx.likedTracks) {
      pool.set(track.id, { track, weight: 5 });
    }
    for (const entry of ctx.history) {
      const decay = 1 + 0.5 * Math.exp(-(Date.now() - entry.playedAt) / WEEK_MS);
      const prev = pool.get(entry.track.id);
      pool.set(entry.track.id, { track: entry.track, weight: (prev?.weight ?? 0) + decay });
    }
    for (const candidate of ctx.candidates) {
      if (!pool.has(candidate.id)) {
        pool.set(candidate.id, { track: candidate, weight: 1 });
      }
    }

    const recent = ctx.recentIds ?? new Set<string>();
    for (const id of recent) {
      pool.delete(id);
    }

    for (const item of pool.values()) {
      if (topGenreSet.has(item.track.genre ?? "")) {
        item.weight *= 2;
      }
    }

    const entries = [...pool.values()];
    const result: Track[] = [];
    for (let i = 0; i < limit && entries.length > 0; i++) {
      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      let roll = this.rng() * total;
      let picked = 0;
      for (let j = 0; j < entries.length; j++) {
        roll -= entries[j].weight;
        if (roll <= 0) {
          picked = j;
          break;
        }
      }
      const [chosen] = entries.splice(picked, 1);
      result.push(chosen.track);
    }
    return result;
  }
}

/**
 * «Умная» волна: взвешенная выборка (как в WeightedRandomWaveSource)
 * плюс скоринг кандидатов по совпадению жанра/артиста с топом
 * библиотеки и контроль разнообразия (несколько треков одного артиста
 * подряд понижают вес).
 */
export class SmartWaveSource implements WaveSource {
  constructor(private rng: () => number = Math.random) {}

  generate(limit: number, ctx: WaveContext): Track[] {
    const pool = new Map<string, { track: Track; weight: number }>();
    const topGenres = [...ctx.libraryGenres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);
    const topGenreSet = new Set(topGenres);
    const topArtists = new Set<string>();
    for (const entry of ctx.history) {
      if (entry.track.artist) topArtists.add(entry.track.artist);
    }
    for (const track of ctx.likedTracks) {
      if (track.artist) topArtists.add(track.artist);
    }

    for (const track of ctx.likedTracks) {
      pool.set(track.id, { track, weight: 5 });
    }
    for (const entry of ctx.history) {
      const decay = 1 + 0.5 * Math.exp(-(Date.now() - entry.playedAt) / WEEK_MS);
      const prev = pool.get(entry.track.id);
      pool.set(entry.track.id, { track: entry.track, weight: (prev?.weight ?? 0) + decay });
    }
    for (const candidate of ctx.candidates) {
      if (!pool.has(candidate.id)) {
        pool.set(candidate.id, { track: candidate, weight: 1 });
      }
    }

    const recent = ctx.recentIds ?? new Set<string>();
    for (const id of recent) {
      pool.delete(id);
    }

    const chosenArtists = new Map<string, number>();
    for (const item of pool.values()) {
      let { weight } = item;
      if (topGenreSet.has(item.track.genre ?? "")) weight *= 2.5;
      if (topArtists.has(item.track.artist ?? "")) weight *= 2;
      item.weight = weight;
    }

    const entries = [...pool.values()];
    const result: Track[] = [];
    for (let i = 0; i < limit && entries.length > 0; i++) {
      for (const item of entries) {
        const artist = item.track.artist ?? "";
        const already = chosenArtists.get(artist) ?? 0;
        if (already > 0) {
          item.weight = item.weight * 0.4 * Math.pow(0.5, already - 1);
        }
      }
      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      let roll = this.rng() * total;
      let picked = 0;
      for (let j = 0; j < entries.length; j++) {
        roll -= entries[j].weight;
        if (roll <= 0) {
          picked = j;
          break;
        }
      }
      const [chosen] = entries.splice(picked, 1);
      result.push(chosen.track);
      const artist = chosen.track.artist ?? "";
      chosenArtists.set(artist, (chosenArtists.get(artist) ?? 0) + 1);
    }
    return result;
  }
}

/** Сервис Wave: собирает контекст из хранилища и провайдеров. */
export class WaveEngine {
  private recentIds = new Set<string>();
  private readonly recentCap = 100;
  /** Фильтр «что не включать в волну» (заблокированные треки/артисты). */
  private blockFilter: (track: Track) => boolean = () => true;

  constructor(
    private storage: Storage,
    private providers: MusicProvider[],
    private source: WaveSource,
  ) {}

  /** Установить фильтр исключений (по умолчанию ничего не исключает). */
  setBlockFilter(fn: (track: Track) => boolean): void {
    this.blockFilter = fn;
  }

  async generateWave(limit = 20): Promise<Track[]> {
    const likedTracks = await this.storage.getLikedTracks();
    const history = await this.storage.getHistory(100);
    const libraryGenres = new Map<string, number>();
    const artistCounts = new Map<string, number>();
    for (const entry of history) {
      const genre = entry.track.genre;
      if (genre) libraryGenres.set(genre, (libraryGenres.get(genre) ?? 0) + 1);
      const artist = entry.track.artist;
      if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }
    for (const track of likedTracks) {
      const artist = track.artist;
      if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }
    const candidates = await this.fetchCandidates(libraryGenres, artistCounts, limit);
    const tracks = this.source.generate(limit, {
      likedTracks,
      history,
      libraryGenres,
      candidates,
      recentIds: this.recentIds,
    });
    const filtered = tracks.filter(this.blockFilter);
    for (const t of filtered) {
      this.recentIds.add(t.id);
    }
    if (this.recentIds.size > this.recentCap) {
      const toDrop = this.recentIds.size - this.recentCap;
      let dropped = 0;
      for (const id of this.recentIds) {
        if (dropped >= toDrop) break;
        this.recentIds.delete(id);
        dropped++;
      }
    }
    return filtered;
  }

  private async fetchCandidates(
    genres: Map<string, number>,
    artistCounts: Map<string, number>,
    limit: number,
  ): Promise<Track[]> {
    const out: Track[] = [];
    const seen = new Set<string>();

    const collect = async (query: string) => {
      const results = await Promise.allSettled(this.providers.map((p) => p.search(query)));
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const t of r.value.tracks) {
          if (t.meta?.noPlay || seen.has(t.id) || !this.blockFilter(t)) continue;
          seen.add(t.id);
          out.push(t);
        }
      }
    };

    const top = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [genre] of top) {
      await collect(genre);
    }

    const topArtist = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topArtist) {
      const similar = await this.fetchSimilarArtists(topArtist);
      for (const artist of similar.slice(0, 4)) {
        await collect(artist);
      }
    }

    return out.slice(0, limit * 2);
  }

  private async fetchSimilarArtists(artist: string): Promise<string[]> {
    const results = await Promise.allSettled(
      this.providers.map((p) => p.getSimilarArtists?.(artist) ?? Promise.resolve([])),
    );
    const names = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const n of r.value) names.add(n);
      }
    }
    names.delete(artist);
    return [...names];
  }
}
