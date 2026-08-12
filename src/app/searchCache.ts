import type { SearchResults } from "../core/types";

const cache = new Map<string, SearchResults[]>();
const CACHE_LIMIT = 30;

export function getCachedResults(query: string): SearchResults[] | undefined {
  return cache.get(query.toLowerCase().trim());
}

export function setCachedResults(query: string, results: SearchResults[]): void {
  const key = query.toLowerCase().trim();
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, results);
}

export function clearSearchCache(): void {
  cache.clear();
}
