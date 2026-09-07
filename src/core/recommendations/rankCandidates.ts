import type { Track } from "../types";

const FULL_PLAYBACK_PROVIDERS = new Set(["youtube", "soundcloud"]);

export interface RankedCandidate {
  track: Track;
  score: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of b) if (a.has(t)) hit++;
  return hit / Math.min(a.size, b.size);
}

function identityTokens(t: Track): Set<string> {
  return new Set([...tokenize(t.title), ...tokenize(t.artist ?? "")]);
}

export function scoreCandidate(seed: Track, candidate: Track): number {
  const seedTokens = identityTokens(seed);
  const candTokens = identityTokens(candidate);

  // Каноничные стоп-слова, чтобы "remix"/"edit"/"version" не решали всё.
  const stop = new Set(["feat", "ft", "remix", "edit", "version", "live", "acoustic", "official"]);
  const seedId = new Set([...seedTokens].filter((t) => !stop.has(t)));
  const candId = new Set([...candTokens].filter((t) => !stop.has(t)));
  const textFit = overlap(seedId, candId) * 0.6 + overlap(seedTokens, candTokens) * 0.4;

  const providerFit = FULL_PLAYBACK_PROVIDERS.has(candidate.provider) ? 1 : 0.6;

  let durationFit = 0.5;
  const dur = candidate.duration;
  if (typeof dur === "number" && dur > 0) {
    durationFit = dur >= 60 && dur <= 900 ? 1 : dur < 20 ? 0.25 : 0.8;
  }

  return textFit * 0.45 + providerFit * 0.3 + durationFit * 0.25;
}

function dedupeKey(t: Track): string {
  return normalize(`${t.artist ?? ""}::${t.title}`);
}

/**
 * Ранжирует кандидатов (похожесть на сид + качество провайдера) и
 * схлопывает дубликаты одного трека, встреченного у разных провайдеров.
 */
export function rankCandidates(seed: Track, candidates: Track[], limit = 12): Track[] {
  const best = new Map<string, RankedCandidate>();
  for (const cand of candidates) {
    const score = scoreCandidate(seed, cand);
    const key = dedupeKey(cand);
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { track: cand, score });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.track);
}
