import type { TrackSource } from "../types";

function normalized(value?: string): string {
  return (value ?? "").normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function title(value: string): string {
  // Strip packaging labels only. Keep live/remix/remaster/acoustic/edit labels:
  // they describe the recording and must never disappear during matching.
  return normalized(value.replace(/\s*[([]\s*(?:official\s+(?:music\s+)?(?:audio|video)|lyrics?|lyric\s+video)\s*[)\]]/gi, ""));
}

export function sameRecording(a: TrackSource, b: TrackSource): boolean {
  if (a.id && a.id === b.id && a.provider === b.provider) return true;
  const artist = normalized(a.artist);
  if (!artist || artist !== normalized(b.artist)) return false;
  const name = title(a.title);
  if (!name || name !== title(b.title)) return false;
  const duration = (t: TrackSource) => Number.isFinite(t.duration) && (t.duration ?? 0) > 0
    && !(t.meta?.preview && t.duration! <= 60) ? t.duration! : null;
  const ad = duration(a), bd = duration(b);
  if (ad !== null && bd !== null && Math.abs(ad - bd) > Math.min(6, Math.max(3, Math.min(ad, bd) * 0.02))) return false;
  return true;
}
