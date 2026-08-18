import type { HistoryEntry, Track } from "../types";
import type { Storage } from "../database/Storage";
import type { MusicProvider } from "../providers/MusicProvider";
import { expandSearchQueries, getSpotifyGenres, getMoodProfile, normalizeGenre } from "../recommendations/moodTaxonomy";
import { buildListeningProfile, profileToSearchTerms, type ListeningProfile } from "../recommendations/listeningProfile";

export interface WaveContext {
  likedTracks: Track[];
  history: HistoryEntry[];
  libraryGenres: Map<string, number>;
  candidates: Track[];
  recentIds?: Set<string>;
  profile?: ListeningProfile;
}

export interface WaveSource {
  generate(limit: number, ctx: WaveContext): Track[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

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

    const entries = [...pool.values()].map((e) => ({ track: e.track, weight: e.weight, base: e.weight }));
    const result: Track[] = [];
    for (let i = 0; i < limit && entries.length > 0; i++) {
      for (const item of entries) {
        const already = chosenArtists.get(item.track.artist ?? "") ?? 0;
        item.weight = already > 0 ? item.base * 0.4 * Math.pow(0.5, already - 1) : item.base;
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

export class WaveEngine {
  private recentIds = new Set<string>();
  private readonly recentCap = 100;
  private cachedProfile: ListeningProfile | null = null;
  private profileCacheTime = 0;
  private readonly PROFILE_TTL = 5 * 60 * 1000;
  
  private blockFilter: (track: Track) => boolean = () => true;

  constructor(
    private storage: Storage,
    private providers: MusicProvider[],
    private source: WaveSource,
  ) {}

  
  setBlockFilter(fn: (track: Track) => boolean): void {
    this.blockFilter = fn;
  }

  
  markPlayed(track: Track): void {
    this.recentIds.add(track.id);
    this.trimRecent();
  }

  private async getProfile(): Promise<ListeningProfile> {
    const now = Date.now();
    if (this.cachedProfile && now - this.profileCacheTime < this.PROFILE_TTL) {
      return this.cachedProfile;
    }
    const likedTracks = await this.storage.getLikedTracks();
    const history = await this.storage.getHistory(200);
    this.cachedProfile = buildListeningProfile(history, likedTracks);
    this.profileCacheTime = now;
    return this.cachedProfile;
  }

  async generateWave(limit = 20): Promise<Track[]> {
    const likedTracks = await this.storage.getLikedTracks();
    const history = await this.storage.getHistory(100);
    const profile = await this.getProfile();

    const libraryGenres = new Map<string, number>();
    const artistCounts = new Map<string, number>();
    for (const entry of history) {
      const genre = entry.track.genre;
      if (genre) {
        const normalized = normalizeGenre(genre);
        libraryGenres.set(normalized, (libraryGenres.get(normalized) ?? 0) + 1);
      }
      const artist = entry.track.artist;
      if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }
    for (const track of likedTracks) {
      const artist = track.artist;
      if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    }

    const candidates = await this.fetchCandidatesMood(profile, libraryGenres, artistCounts, limit);

    const tracks = this.source.generate(limit, {
      likedTracks,
      history,
      libraryGenres,
      candidates,
      recentIds: this.recentIds,
      profile,
    });
    const filtered = tracks.filter(this.blockFilter);
    for (const t of filtered) {
      this.recentIds.add(t.id);
    }
    this.trimRecent();
    return filtered;
  }

  private trimRecent(): void {
    if (this.recentIds.size <= this.recentCap) return;
    const toDrop = this.recentIds.size - this.recentCap;
    let dropped = 0;
    for (const id of this.recentIds) {
      if (dropped >= toDrop) break;
      this.recentIds.delete(id);
      dropped++;
    }
  }

  private async fetchCandidatesMood(
    profile: ListeningProfile,
    _genres: Map<string, number>,
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

    const moodQueries = expandSearchQueries(profile.topMoods, profile.topGenres.slice(0, 3));
    const profileTerms = profileToSearchTerms(profile);
    const allQueries = [...new Set([...moodQueries, ...profileTerms])].slice(0, 12);

    await Promise.all(allQueries.map((q) => collect(q)));

    const spotifyGenres = getSpotifyGenres(profile.topMoods);
    const moodProfile = getMoodProfile(profile.topMoods);
    const targetEnergy = (moodProfile.energy[0] + moodProfile.energy[1]) / 2;
    const targetValence = (moodProfile.valence[0] + moodProfile.valence[1]) / 2;
    const targetAcousticness = (moodProfile.acousticness[0] + moodProfile.acousticness[1]) / 2;

    const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const moodOptions = {
      moods: profile.topMoods,
      genres: spotifyGenres.slice(0, 2),
      targetEnergy,
      targetValence,
      targetAcousticness,
    };

    for (const [artist] of topArtists) {
      const similar = await this.fetchSimilarArtistsMood(artist, moodOptions);
      for (const q of similar.slice(0, 2)) {
        await collect(q);
      }
    }

    const topTracks = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    await Promise.all(topTracks.map(([artist]) => this.collectSimilarMood(artist, "", moodOptions, out, seen)));

    return out.slice(0, limit * 3);
  }

  private async collectSimilarMood(
    artist: string,
    track: string,
    options: import("../providers/MusicProvider").MoodRecommendOptions,
    out: Track[],
    seen: Set<string>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      this.providers
        .filter((p) => typeof p.getSimilarTracks === "function")
        .map((p) => p.getSimilarTracks?.(artist, track, options) ?? Promise.resolve([])),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const t of r.value) {
        if (t.meta?.noPlay || seen.has(t.id) || !this.blockFilter(t)) continue;
        seen.add(t.id);
        out.push(t);
      }
    }
  }

  private async fetchSimilarArtistsMood(
    artist: string,
    _options: import("../providers/MusicProvider").MoodRecommendOptions,
  ): Promise<string[]> {
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
