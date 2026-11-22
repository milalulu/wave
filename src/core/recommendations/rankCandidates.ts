import { recommendationArtist, recommendationEdition, uniqueRecommendations } from "../recordings/matching";
import type { Track } from "../types";
import { detectMoods, normalizeGenre } from "./moodTaxonomy";

const FULL_PLAYBACK_PROVIDERS = new Set(["youtube", "soundcloud"]);
const genericTags = new Set(["music", "audio", "official", "track", "song", "new music", "popular", "other", "unknown", "all"]);
const nonSong = /(?:\b(?:full album|dj set|type beat|free beat|one hour|30 minutes|reaction video|interview|podcast|music compilation)\b|(?:^|\s)(?:подкаст|реакция на|сборник песен)(?=\s|$))/iu;

function trackTags(track: Track): Set<string> {
  const tags = Array.isArray(track.meta?.tags) ? track.meta.tags : [];
  return new Set(tags.filter((tag): tag is string => typeof tag === "string")
    .map((tag) => normalizeGenre(tag.replace(/^#/u, ""))).filter((tag) => tag && !genericTags.has(tag)));
}

function trackGenre(track: Track) {
  const genre = normalizeGenre(track.genre ?? "");
  return genericTags.has(genre) ? "" : genre;
}

function artistKey(track: Track) {
  return recommendationArtist(typeof track.meta?.creditedArtist === "string" ? track.meta.creditedArtist : track.artist);
}

function intersection<T>(a: Set<T>, b: Set<T>) {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}

function describe(track: Track) {
  const genre = trackGenre(track);
  const tags = trackTags(track);
  const moods = new Set(detectMoods([genre, ...tags].filter(Boolean)));
  const fallbackMoods = moods.size ? moods : new Set(detectMoods([], track.title));
  return { track, artist: artistKey(track), genre, tags, moods, fallbackMoods };
}

type Descriptor = ReturnType<typeof describe>;

function affinity(seed: Descriptor, candidate: Descriptor) {
  const artist = seed.artist !== "" && seed.artist === candidate.artist;
  const genre = seed.genre !== "" && seed.genre === candidate.genre;
  const styles = intersection(seed.moods, candidate.moods);
  const tags = intersection(seed.tags, candidate.tags);
  const hints = intersection(seed.fallbackMoods, candidate.fallbackMoods);
  const wrongStyle = !!seed.genre && !!candidate.genre && !genre && !styles && !tags;
  const relation = candidate.track.meta?.relatedTo === seed.track.id;
  const rank = typeof candidate.track.meta?.relatedRank === "number" ? candidate.track.meta.relatedRank : 10;
  const a = seed.track.meta?.bpm;
  const b = candidate.track.meta?.bpm;
  const distance = typeof a === "number" && a > 0 && typeof b === "number" && b > 0 ? Math.abs(Math.log2(a / b)) : null;
  const beat = distance === null ? 0 : Math.min(Math.abs(distance - 1), distance) < .16 ? .08 : -.12;
  let evidence = (artist ? .46 : 0) + (genre ? .41 : 0) + Math.min(.29, tags * .14)
    + (styles ? .23 + (styles - 1) * .04 : hints ? .10 : 0)
    + (relation ? .56 - Math.min(rank, 15) * .013 : 0);
  // A known style mismatch wins over a weak hint from the related list.
  if (wrongStyle) evidence *= artist ? .67 : .26;
  return evidence > 0 ? evidence + beat : 0;
}

function quality(track: Track) {
  const dur = track.duration;
  const playable = FULL_PLAYBACK_PROVIDERS.has(track.provider) || track.provider === "local";
  return (playable ? .16 : .04)
    + (dur && dur >= 60 && dur <= 660 ? .10 : dur && dur < 20 ? -.12 : 0)
    - (track.meta?.preview ? .28 : 0)
    - recommendationEdition(track) * .16;
}

export function scoreCandidate(seed: Track, candidate: Track): number {
  return affinity(describe(seed), describe(candidate)) + quality(candidate);
}

export type RecommendationOptions = {
  strict?: boolean;
  excluded?: readonly Track[];
  taste?: readonly Track[];
  feedback?: { more: readonly Track[]; less: readonly Track[] };
  annotate?: boolean;
};

export function rankCandidates(seed: Track, candidates: Track[], limit = 12, options: RecommendationOptions = {}): Track[] {
  const anchor = describe(seed);
  const taste = [...(options.feedback?.more ?? []).slice(0, 12), ...(options.taste ?? [])].slice(0, 24).map(describe);
  const dislikes = (options.feedback?.less ?? []).slice(0, 16).map(describe);
  const ranked = candidates.flatMap((track) => {
    if (!track.title.trim() || nonSong.test(track.title) || (track.duration && track.duration > 20 * 60)) return [];
    const descriptor = describe(track);
    const seedFit = affinity(anchor, descriptor);
    const tasteFit = Math.max(0, ...taste.map((reference) => affinity(reference, descriptor)));
    const evidence = Math.max(seedFit, tasteFit * .81);
    if (options.strict && (evidence < .26 || recommendationEdition(track) === 2 && evidence < .49)) return [];
    const penalty = Math.min(.35, Math.max(0, ...dislikes.map((reference) => affinity(reference, descriptor) * .40)));
    const reason = tasteFit * .81 > seedFit ? "taste" : track.meta?.relatedTo === seed.id ? "related"
      : anchor.artist && anchor.artist === descriptor.artist ? "artist" : "style";
    return [{ track, reason, artist: descriptor.artist, score: .86 * evidence + .14 * seedFit + quality(track) - penalty }];
  }).sort((a, b) => b.score - a.score);

  const deduped = new Set(uniqueRecommendations(ranked.map(({ track }) => track), [
    ...(options.excluded ?? []), ...(options.feedback?.less ?? []),
  ]));
  const pool = ranked.filter(({ track }) => deduped.delete(track));
  const picked: Track[] = [];
  const counts = new Map<string, number>();
  while (picked.length < limit && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < pool.length; index++) {
      const { artist, score } = pool[index];
      const adjusted = score - (artist ? (counts.get(artist) ?? 0) * .13 : 0);
      if (adjusted > bestScore) { bestScore = adjusted; best = index; }
    }
    const [{ track, artist, reason }] = pool.splice(best, 1);
    picked.push(options.annotate ? { ...track, meta: { ...track.meta, recommendationReason: reason } } : track);
    if (artist) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return picked;
}
