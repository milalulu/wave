import type { Track } from "../types";
import type { HistoryEntry } from "../types";
import { type Mood, detectMoods, MOOD_TAXONOMY, normalizeGenre } from "./moodTaxonomy";

export interface ListeningProfile {
  topMoods: Mood[];
  topGenres: string[];
  topArtists: { artist: string; plays: number }[];
  moodDistribution: Record<Mood, number>;
  genreDistribution: Record<string, number>;
  energyPreference: number;
  acousticPreference: number;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

export function buildListeningProfile(
  history: HistoryEntry[],
  likedTracks: Track[],
): ListeningProfile {
  const artistPlays = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const moodCounts = new Map<Mood, number>();
  const now = Date.now();

  for (const entry of history) {
    const age = now - entry.playedAt;
    const recency = Math.max(0.2, 1 - age / (12 * WEEK_MS));

    const artist = entry.track.artist;
    if (artist) {
      artistPlays.set(artist, (artistPlays.get(artist) ?? 0) + recency);
    }

    const genre = entry.track.genre;
    if (genre) {
      const normalized = normalizeGenre(genre);
      genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + recency);
    }

    const moods = detectMoods(
      genre ? [genre] : [],
      entry.track.title,
      entry.track.artist,
    );
    for (const mood of moods) {
      moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + recency);
    }
  }

  for (const track of likedTracks) {
    const artist = track.artist;
    if (artist) {
      artistPlays.set(artist, (artistPlays.get(artist) ?? 0) + 2);
    }

    const genre = track.genre;
    if (genre) {
      const normalized = normalizeGenre(genre);
      genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + 2);
    }

    const moods = detectMoods(
      genre ? [genre] : [],
      track.title,
      track.artist,
    );
    for (const mood of moods) {
      moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 2);
    }
  }

  const totalMoodWeight = [...moodCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const moodDistribution: Record<Mood, number> = {
    chill: 0, sad: 0, happy: 0, energetic: 0, dark: 0,
    dreamy: 0, aggressive: 0, romantic: 0, focus: 0, party: 0,
  };
  for (const [mood, count] of moodCounts) {
    moodDistribution[mood] = count / totalMoodWeight;
  }

  const totalGenreWeight = [...genreCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const genreDistribution: Record<string, number> = {};
  for (const [genre, count] of genreCounts) {
    genreDistribution[genre] = count / totalGenreWeight;
  }

  const topMoods = [...moodCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mood]) => mood);

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);

  const topArtists = [...artistPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([artist, plays]) => ({ artist, plays }));

  let energyPreference = 0.5;
  let acousticPreference = 0.5;
  if (topMoods.length > 0) {
    let totalE = 0, totalA = 0;
    for (const mood of topMoods) {
      const p = MOOD_TAXONOMY[mood].profile;
      totalE += (p.energy[0] + p.energy[1]) / 2;
      totalA += (p.acousticness[0] + p.acousticness[1]) / 2;
    }
    energyPreference = totalE / topMoods.length;
    acousticPreference = totalA / topMoods.length;
  }

  return {
    topMoods,
    topGenres,
    topArtists,
    moodDistribution,
    genreDistribution,
    energyPreference,
    acousticPreference,
  };
}

export function profileToSearchTerms(profile: ListeningProfile): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (t: string): void => {
    const k = t.toLowerCase().trim();
    if (!seen.has(k)) { seen.add(k); terms.push(t); }
  };

  for (const mood of profile.topMoods) {
    for (const kw of MOOD_TAXONOMY[mood].keywords.slice(0, 3)) add(kw);
  }

  for (const genre of profile.topGenres.slice(0, 3)) {
    add(genre);
  }

  if (profile.energyPreference < 0.3) {
    add("chill");
    add("lo-fi");
  } else if (profile.energyPreference > 0.7) {
    add("energetic");
    add("hype");
  }

  if (profile.acousticPreference > 0.6) {
    add("acoustic");
    add("unplugged");
  }

  return terms.slice(0, 10);
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type DayType = "weekday" | "weekend";

export interface TimeContext {
  timeOfDay: TimeOfDay;
  dayType: DayType;
}

export function getCurrentTimeContext(): TimeContext {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  let timeOfDay: TimeOfDay;
  if (hour >= 5 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 22) timeOfDay = "evening";
  else timeOfDay = "night";

  const dayType: DayType = day === 0 || day === 6 ? "weekend" : "weekday";

  return { timeOfDay, dayType };
}

export function timeAdjustedMoodDistribution(
  moodDistribution: Record<Mood, number>,
  timeCtx: TimeContext,
): Record<Mood, number> {
  const morningMoods: Partial<Record<Mood, number>> = {
    happy: 1.3,
    energetic: 1.2,
    focus: 1.1,
    chill: 0.8,
  };
  const eveningMoods: Partial<Record<Mood, number>> = {
    chill: 1.3,
    romantic: 1.2,
    dreamy: 1.1,
    party: 1.2,
    sad: 1.1,
  };
  const nightMoods: Partial<Record<Mood, number>> = {
    chill: 1.4,
    dreamy: 1.3,
    dark: 1.1,
    sad: 1.1,
    party: 0.5,
    energetic: 0.4,
  };
  const weekdayMoods: Partial<Record<Mood, number>> = {
    focus: 1.3,
    chill: 1.1,
    party: 0.5,
    aggressive: 0.6,
  };
  const weekendMoods: Partial<Record<Mood, number>> = {
    party: 1.3,
    energetic: 1.2,
    dark: 1.1,
    focus: 0.7,
  };

  const adjusted: Record<Mood, number> = { ...moodDistribution };
  const modifiers: Partial<Record<Mood, number>> = {};

  if (timeCtx.timeOfDay === "morning") Object.assign(modifiers, morningMoods);
  if (timeCtx.timeOfDay === "evening") Object.assign(modifiers, eveningMoods);
  if (timeCtx.timeOfDay === "night") Object.assign(modifiers, nightMoods);
  if (timeCtx.dayType === "weekday") Object.assign(modifiers, weekdayMoods);
  if (timeCtx.dayType === "weekend") Object.assign(modifiers, weekendMoods);

  for (const [mood, factor] of Object.entries(modifiers)) {
    const m = mood as Mood;
    if (!adjusted[m]) continue;
    adjusted[m] = Math.min(1.0, adjusted[m] * (factor ?? 1));
  }

  const total = (Object.keys(adjusted) as Mood[]).reduce((a, m) => a + adjusted[m], 0) || 1;
  for (const m in adjusted) {
    adjusted[m as Mood] /= total;
  }

  return adjusted;
}

export function timeAwareSearchTerms(profile: ListeningProfile, timeCtx: TimeContext): string[] {
  const terms = profileToSearchTerms(profile);
  const extra: string[] = [];

  switch (timeCtx.timeOfDay) {
    case "morning":
      extra.push("upbeat", "focus");
      break;
    case "afternoon":
      extra.push("energetic");
      break;
    case "evening":
      extra.push("chill", "relaxed");
      break;
    case "night":
      extra.push("ambient", "deep focus");
      break;
  }

  if (timeCtx.dayType === "weekday") {
    extra.push("study", "focus", "instrumental");
  } else {
    extra.push("party", "dance", "fun");
  }

  for (const t of extra) {
    const k = t.toLowerCase();
    if (!terms.some((existing) => existing.toLowerCase() === k)) {
      terms.push(t);
    }
  }

  return terms.slice(0, 12);
}
