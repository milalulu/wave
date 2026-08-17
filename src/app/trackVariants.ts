import type { MusicProvider } from "../core/providers/MusicProvider";
import type { Track } from "../core/types";
import { getPreferredProviders } from "./platformSettings";

export interface TrackVariant {
  providerId: string;
  track: Track;
}

const NO_VARIANT_SOURCES = new Set(["local", "musicbrainz"]);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; variants: TrackVariant[] }>();

export function clearVariantsCache(): void {
  cache.clear();
}

function norm(s?: string): string {
  return (s ?? "").trim().toLocaleLowerCase();
}

export function isVariantOf(variant: Track, track: Track): boolean {
  const vt = norm(variant.title);
  const tt = norm(track.title);
  const va = norm(variant.artist);
  const ta = norm(track.artist);
  if (!vt || !tt) return false;
  if (vt !== tt && !(vt.includes(tt) || tt.includes(vt))) return false;
  if (ta && va && ta !== va) return false;
  return true;
}

export async function findTrackVariants(
  providers: MusicProvider[],
  track: Track,
): Promise<TrackVariant[]> {
  const hit = cache.get(track.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.variants;  const query = [track.artist, track.title].filter(Boolean).join(" ").trim();
  if (!query || !track.title) return [];
  const others = providers.filter(
    (p) => p.id !== track.provider && !NO_VARIANT_SOURCES.has(p.id),
  );
  const settled = await Promise.allSettled(others.map((p) => p.search(query)));
  const variants: TrackVariant[] = [];
  const seen = new Set<string>([track.id]);
  for (let i = 0; i < others.length; i++) {
    const r = settled[i];
    const provider = others[i];
    if (r.status !== "fulfilled") continue;
    for (const t of r.value.tracks) {
      if (t.meta?.noPlay || seen.has(t.id)) continue;
      if (!isVariantOf(t, track)) continue;
      seen.add(t.id);
      variants.push({ providerId: provider.id, track: t });
    }
  }
  const ordered = orderVariants(variants);
  cache.set(track.id, { at: Date.now(), variants: ordered });
  return ordered;
}

function orderVariants(variants: TrackVariant[]): TrackVariant[] {
  const preferred = getPreferredProviders();
  if (preferred.length === 0) return variants;
  const rank = new Map(preferred.map((id, i) => [id, i]));
  return [...variants].sort((a, b) => {
    const ra = rank.get(a.providerId);
    const rb = rank.get(b.providerId);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}
