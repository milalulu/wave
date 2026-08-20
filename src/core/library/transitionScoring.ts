import type { Track } from "../types";

export interface TransitionScore {
  bpmFit: number;
  tagOverlap: number;
  eraFit: number;
  total: number;
}

export function scoreTransition(prev: Track, candidate: Track): TransitionScore {
  const bpmFit = computeBpmFit(prev, candidate);
  const tagOverlap = computeTagOverlap(prev, candidate);
  const eraFit = computeEraFit(prev, candidate);
  const total = bpmFit * 0.5 + tagOverlap * 0.3 + eraFit * 0.2;
  return { bpmFit, tagOverlap, eraFit, total };
}

function computeBpmFit(prev: Track, candidate: Track): number {
  const prevBpm = (prev.meta?.bpm as number) ?? 0;
  const candBpm = (candidate.meta?.bpm as number) ?? 0;
  if (prevBpm <= 0 || candBpm <= 0) return 0.5;
  const diff = Math.abs(prevBpm - candBpm) / prevBpm;
  if (diff <= 0.1) return 1.0;
  return Math.max(0.1, 1 - (diff - 0.1) * 5);
}

function computeTagOverlap(prev: Track, candidate: Track): number {
  const prevTags = (prev.meta?.tags as string[]) ?? [];
  const candTags = (candidate.meta?.tags as string[]) ?? [];
  if (prevTags.length === 0 || candTags.length === 0) return 0.5;
  const prevSet = new Set(prevTags);
  let intersection = 0;
  for (const t of candTags) {
    if (prevSet.has(t)) intersection++;
  }
  const union = new Set([...prevTags, ...candTags]).size;
  return union > 0 ? intersection / union : 0.5;
}

function computeEraFit(prev: Track, candidate: Track): number {
  const prevYear = prev.year ?? 0;
  const candYear = candidate.year ?? 0;
  if (prevYear <= 0 || candYear <= 0) return 0.5;
  const yearDiff = Math.abs(prevYear - candYear);
  if (yearDiff <= 15) return 1.0;
  const prevTags = new Set((prev.meta?.tags as string[]) ?? []);
  const candTags = (candidate.meta?.tags as string[]) ?? [];
  const sharedSubgenres = candTags.filter((t) => prevTags.has(t));
  if (sharedSubgenres.length > 0) return 1.0;
  return Math.max(0.3, 1 - (yearDiff - 15) * 0.02);
}

export function applyTransitionPenalty(weight: number, score: TransitionScore): number {
  if (score.total < 0.2) return 0;
  if (score.total < 0.4) return weight * 0.4;
  return weight;
}
