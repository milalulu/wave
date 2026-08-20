import type { HistoryEntry, Track } from "../types";
import type { Storage } from "../database/Storage";
import type { MusicProvider } from "../providers/MusicProvider";
import { expandSearchQueries, getSpotifyGenres, getMoodProfile, normalizeGenre, detectMoods } from "../recommendations/moodTaxonomy";
import { buildListeningProfile, timeAwareSearchTerms, getCurrentTimeContext, timeAdjustedMoodDistribution, type ListeningProfile, type TimeContext } from "../recommendations/listeningProfile";

function detectTrackMoodScore(track: Track, moodDistribution: Record<string, number>): number {
  const moods = detectMoods(
    track.genre ? [track.genre] : [],
    track.title,
    track.artist,
  );
  if (moods.length === 0) return 0.5;
  const topScore = Math.max(...moods.map((m) => moodDistribution[m] ?? 0));
  return topScore;
}export interface WaveContext {
  likedTracks: Track[];
  history: HistoryEntry[];
  libraryGenres: Map<string, number>;
  artistCounts: Map<string, number>;
  moodDistribution: Record<string, number>;
  candidates: Track[];
  recentIds?: Set<string>;
  profile?: ListeningProfile;
  historyDecayDays?: number;
  discoveryRate?: number;
}

export interface WaveSource {
  generate(limit: number, ctx: WaveContext): Track[];
}



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
      pool.set(track.id, { track, weight: 10 });
    }
     for (const entry of ctx.history) {
      const decayDays = ctx.historyDecayDays ?? 7;
      const decayMs = decayDays * 24 * 3600 * 1000;
      const decay = 1 + 0.5 * Math.exp(-(Date.now() - entry.playedAt) / decayMs);
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
    const likedIds = new Set(ctx.likedTracks.map((t) => t.id));
    const artistPlays = new Map<string, number>();
    for (const entry of ctx.history) {
      const a = entry.track.artist ?? "";
      if (a) artistPlays.set(a, (artistPlays.get(a) ?? 0) + 1);
    }
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

      const artist = chosen.track.artist ?? "";
      if (artistPlays.has(artist)) {
        for (const item of entries) {
          if (item.track.artist === artist) {
            if (!likedIds.has(item.track.id)) {
              item.weight *= 0.3;
            } else {
              item.weight *= 0.7;
            }
          }
        }
      }
    }
    return result;
  }
}

type CandidateCategory = "direct" | "deepcut" | "wildcard";

function categorizeCandidate(
  track: Track,
  tagWeights: Map<string, number>,
): CandidateCategory {
  const pop = (track.meta?.popularity as number) ?? 50;
  const tags = (track.meta?.tags as string[]) ?? [];
  let tagSim = 0;
  if (tags.length > 0 && tagWeights.size > 0) {
    let dot = 0;
    for (const t of tags) dot += tagWeights.get(t) ?? 0;
    tagSim = dot / tags.length;
  }
  if (pop > 60 && tagSim > 0.3) return "direct";
  if (pop <= 40 || tagSim < 0.2) return "deepcut";
  return "wildcard";
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
    const maxArtistCount = Math.max(1, ...ctx.artistCounts.values());
    const topArtists = new Map<string, number>();
    for (const [artist, count] of ctx.artistCounts) {
      topArtists.set(artist, 1 + Math.log2(count) / Math.log2(maxArtistCount));
    }

    for (const track of ctx.likedTracks) {
      pool.set(track.id, { track, weight: 10 });
    }
     for (const entry of ctx.history) {
       const decayDays = ctx.historyDecayDays ?? 7;
       const decayMs = decayDays * 24 * 3600 * 1000;
       const decay = 1 + 0.5 * Math.exp(-(Date.now() - entry.playedAt) / decayMs);
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

     const discoveryRate = ctx.discoveryRate ?? 30;
     for (const item of pool.values()) {
       let { weight } = item;
       if (topGenreSet.has(item.track.genre ?? "")) weight *= 2.5;
       const artistBoost = topArtists.get(item.track.artist ?? "") ?? 0;
       if (artistBoost > 0) {
         const discoveryMultiplier = 1 - discoveryRate / 100;
         weight *= 1 + artistBoost * discoveryMultiplier;
       }
       if (ctx.moodDistribution) {
         const moodScore = detectTrackMoodScore(item.track, ctx.moodDistribution);
         weight *= 0.8 + 0.4 * moodScore;
       }
       item.weight = weight;
     }

    const tagWeights = new Map<string, number>();
    for (const item of pool.values()) {
      const tags = (item.track.meta?.tags as string[]) ?? [];
      for (const t of tags) tagWeights.set(t, (tagWeights.get(t) ?? 0) + 1);
    }

    const entries = [...pool.values()].map((e) => ({
      track: e.track,
      weight: e.weight,
      base: e.weight,
      category: categorizeCandidate(e.track, tagWeights),
    }));
    const result: Track[] = [];
    const chosenArtists = new Map<string, number>();
    const chosenGenres = new Map<string, number>();
    const chosenArtistSet = new Set<string>();
    let directCount = 0;
    let deepcutCount = 0;
    let wildcardCount = 0;

    for (let i = 0; i < limit && entries.length > 0; i++) {
      const remaining = limit - i;
      const directQuota = Math.ceil(remaining * 0.7);
      const deepcutQuota = Math.ceil(remaining * 0.2);
      const iterationPicked = i > 0 ? chosenArtistSet.size > 0 : false;

      for (const item of entries) {
        const artist = item.track.artist ?? "";
        const genre = normalizeGenre(item.track.genre ?? "");
        const alreadyArtist = chosenArtists.get(artist) ?? 0;
        const alreadyGenre = chosenGenres.get(genre) ?? 0;
        let w = item.base;
        if (alreadyArtist > 0) w *= 0.4 * Math.pow(0.5, alreadyArtist - 1);
        if (iterationPicked && alreadyGenre === 0 && genre !== "") w *= 1.2;

        const catBonus =
          item.category === "direct"
            ? directCount < directQuota ? 1.0 : 0.3
            : item.category === "deepcut"
              ? deepcutCount < deepcutQuota ? 0.6 : 0.1
              : wildcardCount < (remaining - directQuota - deepcutQuota) ? 0.3 : 0.05;
        w *= catBonus;
        item.weight = w;
      }

      const total = entries.reduce((sum, e) => sum + e.weight, 0);
      if (total <= 0) break;
      let roll = this.rng() * total;
      let picked = 0;
      for (let j = 0; j < entries.length; j++) {
        roll -= entries[j].weight;
        if (roll <= 0) { picked = j; break; }
      }
      const [chosen] = entries.splice(picked, 1);
      result.push(chosen.track);
      const artist = chosen.track.artist ?? "";
      const genre = normalizeGenre(chosen.track.genre ?? "");
      chosenArtists.set(artist, (chosenArtists.get(artist) ?? 0) + 1);
      chosenGenres.set(genre, (chosenGenres.get(genre) ?? 0) + 1);
      chosenArtistSet.add(artist);
      if (chosen.category === "direct") directCount++;
      else if (chosen.category === "deepcut") deepcutCount++;
      else wildcardCount++;
    }
    return result;
  }
}

import { RollingContext } from "./RollingContext";
import { scoreTransition } from "./transitionScoring";

export class WaveEngine {
  private recentIds = new Set<string>();
  private readonly recentCap = 100;
  private cachedProfile: ListeningProfile | null = null;
  private profileCacheTime = 0;
  private readonly PROFILE_TTL = 5 * 60 * 1000;
  private rollingContext = new RollingContext();
  
  private blockFilter: (track: Track) => boolean = () => true;
  private historyDecayDays: number = 7;
  private discoveryRate: number = 30;

  constructor(
    private storage: Storage,
    private providers: MusicProvider[],
    private source: WaveSource,
  ) {}

  setHistoryDecayDays(days: number): void {
    this.historyDecayDays = Math.max(1, days);
  }

  setDiscoveryRate(rate: number): void {
    this.discoveryRate = Math.max(0, Math.min(100, rate));
  }

  
  setBlockFilter(fn: (track: Track) => boolean): void {
    this.blockFilter = fn;
  }

  
  markPlayed(track: Track): void {
    this.recentIds.add(track.id);
    this.rollingContext.addPlayed(track);
    this.trimRecent();
  }

  getRollingContext(): RollingContext {
    return this.rollingContext;
  }

  onTrackSkipped(_track: Track, percent: number): void {
    if (percent < 0.15) {
      this.rollingContext.removeLast();
    }
  }

  onTrackCompleted(track: Track, percent: number): void {
    if (percent > 0.8) {
      this.rollingContext.addPlayed(track);
    }
  }

  private async getProfile(likedTracks: Track[], history: HistoryEntry[]): Promise<ListeningProfile> {
    const now = Date.now();
    if (this.cachedProfile && now - this.profileCacheTime < this.PROFILE_TTL) {
      return this.cachedProfile;
    }
    this.cachedProfile = buildListeningProfile(history, likedTracks);
    this.profileCacheTime = now;
    return this.cachedProfile;
  }

  async generateWave(limit = 20): Promise<Track[]> {
    const likedTracks = await this.storage.getLikedTracks();
    const history = await this.storage.getHistory(200);
    const profile = await this.getProfile(likedTracks, history);

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

    const candidates = await this.fetchCandidatesMood(profile, libraryGenres, artistCounts, limit, history, getCurrentTimeContext());

    const timeCtx = getCurrentTimeContext();
    const moodDistribution = timeAdjustedMoodDistribution(profile.moodDistribution, timeCtx);

     const tracks = this.source.generate(limit, {
      likedTracks,
      history,
      libraryGenres,
      artistCounts,
      moodDistribution,
      candidates,
      recentIds: this.recentIds,
      profile,
      historyDecayDays: this.historyDecayDays,
      discoveryRate: this.discoveryRate,
    });
    const filtered = tracks.filter(this.blockFilter);

    const seed = this.rollingContext.getSeed();
    const lastPlayed = this.rollingContext.getWindow().slice(-1)[0] ?? seed;
    if (lastPlayed) {
      for (let i = 0; i < filtered.length; i++) {
        const prev = i === 0 ? lastPlayed : filtered[i - 1];
        const score = scoreTransition(prev, filtered[i]);
        if (score.total < 0.2) {
          filtered.splice(i, 1);
          i--;
        }
      }
    }
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
    _libraryGenres: Map<string, number>,
    artistCounts: Map<string, number>,
    limit: number,
    _history: HistoryEntry[],
    timeCtx: TimeContext,
  ): Promise<Track[]> {
    const out: Track[] = [];
    const seen = new Set<string>();
    const playableProviders = this.providers.filter(
      (p) => p.id !== "lastfm" && p.id !== "musicbrainz",
    );

    const collect = async (query: string) => {
      const results = await Promise.allSettled(playableProviders.map((p) => p.search(query)));
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
    const profileTerms = timeAwareSearchTerms(profile, timeCtx);
    const allQueries = [...new Set([...moodQueries, ...profileTerms])].slice(0, 12);

    for (let i = 0; i < allQueries.length; i += 4) {
      const batch = allQueries.slice(i, i + 4);
      await Promise.all(batch.map((q) => collect(q)));
    }

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
