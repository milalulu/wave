import type { Track } from "../types";

export interface Suggestion {
  kind: "track" | "query";
  title: string;
  artist?: string;
  track?: Track;
}

export interface SuggestSources {
  liked: Track[];
  history: Track[];
  recent: string[];
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function trackHaystack(t: Track): string {
  return norm(`${t.artist ?? ""} ${t.title}`);
}

/**
 * Локальные подсказки без сети: сначала префиксные совпадения по трекам
 * (лайки + история), затем недавние запросы. Дедуп по нормализованному виду.
 */
export function getSuggestions(query: string, sources: SuggestSources, limit = 8): Suggestion[] {
  const q = norm(query);
  if (!q) return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  const pushTrack = (t: Track): void => {
    const key = `t:${norm(t.artist ?? "")}|${norm(t.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind: "track", title: t.title, artist: t.artist, track: t });
  };

  const pool = [...sources.liked.slice(0, 500), ...sources.history.slice(0, 500)];
  const starts: Track[] = [];
  const contains: Track[] = [];
  for (const t of pool) {
    const hay = trackHaystack(t);
    if (!hay.includes(q)) continue;
    if (hay.startsWith(q) || norm(t.title).startsWith(q)) starts.push(t);
    else contains.push(t);
  }
  for (const t of starts) {
    if (out.length >= limit) break;
    pushTrack(t);
  }
  for (const t of contains) {
    if (out.length >= limit) break;
    pushTrack(t);
  }

  for (const r of sources.recent) {
    if (out.length >= limit) break;
    const n = norm(r);
    if (!n || !n.includes(q)) continue;
    const key = `q:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "query", title: r });
  }
  return out;
}
