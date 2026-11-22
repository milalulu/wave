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

export function verifiedRecordingMatch(a: TrackSource, b: TrackSource): boolean {
  const knownDuration = (track: TrackSource) => Number.isFinite(track.duration) && (track.duration ?? 0) > 0 && !track.meta?.preview;
  return a.provider !== b.provider && knownDuration(a) && knownDuration(b) && sameRecording(a, b);
}

const edition = /(?:\b(?:sped\s*up|speed\s*up|slowed(?:\s*(?:\+|and|&)\s*reverb)?|nightcore|daycore|reverb(?:ed)?|bass\s*boost(?:ed)?|pitch(?:ed|shifted)?|remix(?:ed)?|bootleg|mashup|edit|version|cover|karaoke|instrumental|acoustic|live|remaster(?:ed)?|extended|rework|flip|8d)\b|(?:^|[^\p{L}])(?:ремикс\p{L}*|ускоренн\p{L}*|замедленн\p{L}*|спидап\p{L}*|спид\s*ап\p{L}*|слоу\p{L}*|кавер\p{L}*|переиздани\p{L}*|ремастер\p{L}*)(?!\p{L}))/iu;
const packaging = /^(?:official\s*(?:music\s*)?(?:audio|video)|lyric(?:s|\s*video)?|visuali[sz]er|re(?:[ -]?)upload(?:ed)?|mirror|hq|remastered(?:\s+\d{4})?)$/iu;
const pitchEdit = /\b(?:sped\s*up|speed\s*up|slowed|nightcore|daycore|bass\s*boost(?:ed)?|8d)\b|(?:^|[^\p{L}])(?:спидап\p{L}*|спид\s*ап\p{L}*|слоу\p{L}*|ускоренн\p{L}*|замедленн\p{L}*)(?!\p{L})/iu;
const editionTail = /^(?:live(?: at .+)?|acoustic(?: version)?|version|cover|nightcore|daycore|remix|[\p{L}\p{N} .&+]+ (?:remix|edit)|remaster(?:ed)?(?: \d{4})?|instrumental|karaoke|reverb|extended|bass boost(?:ed)?|8d|ремикс\p{L}*|кавер\p{L}*|ремастер\p{L}*)$/iu;

export function recommendationArtist(artist?: string) {
  return normalized((artist ?? "")
    .replace(/(?:\s+#[\p{L}\p{N}_-]+)+$/u, "")
    .replace(/(?:\s+-\s+topic|\s+official|vevo)$/iu, ""));
}

function recommendationTitle(value: string) {
  const unwrapped = value.replace(/\s*[[(]([^\])]+)[\])]/gu, (full, annotation: string) =>
    edition.test(annotation) || packaging.test(annotation.trim()) || /^(?:feat\.?|ft\.?|prod\.?)\s/iu.test(annotation.trim()) ? "" : full);
  const suffix = unwrapped.split(/\s+[-–—|/]\s+/u);
  while (suffix.length > 1 && (isEditionTail(suffix[suffix.length - 1]) || packaging.test(suffix[suffix.length - 1].trim()))) suffix.pop();
  return normalized(suffix.join(" - ").replace(/\s+(?:(?:sped|speed)\s*up|slowed(?:\s*(?:\+|and|&)\s*reverb)?|nightcore|daycore|remix|remaster(?:ed)?|reupload(?:ed)?|official\s*(?:music\s*)?(?:audio|video)|lyrics?)\s*$/iu, ""));
}

const isEditionTail = (value: string) => editionTail.test(value.trim()) ||
  /^(?:sped\s*up|speed\s*up|slowed|nightcore|daycore|спидап|спид\s*ап|ускоренная|замедленная)(?:\s*(?:\+|&|and)\s*reverb)?$/iu.test(value.trim());

type SongFamily = { id: string; provider: string; titles: string[]; artists: string[]; duration: number; version: boolean; repost: boolean };

function songFamily(track: TrackSource): SongFamily {
  const pieces = track.title.split(/\s+[-–—]\s+/u);
  const artist = recommendationArtist(track.artist);
  const titles = new Set([recommendationTitle(track.title)]);
  const artists = new Set([artist,
    recommendationArtist(typeof track.meta?.creditedArtist === "string" ? track.meta.creditedArtist : undefined)]);
  if (pieces.length > 1 && !isEditionTail(pieces[0]) && !isEditionTail(pieces[1]) && !packaging.test(pieces[1])) {
    const credit = recommendationArtist(pieces[0]);
    const song = recommendationTitle(pieces.slice(1).join(" - "));
    if (credit && song) {
      artists.add(credit);
      titles.add(song);
    }
  }
  titles.delete("");
  artists.delete("");
  return {
    id: track.id, provider: track.provider, titles: [...titles], artists: [...artists],
    duration: track.duration ?? 0,
    version: pieces.length > 1 && isEditionTail(pieces[pieces.length - 1]) ||
      Array.from(track.title.matchAll(/[[(]([^\])]+)[\])]/gu)).some((match) => edition.test(match[1])),
    repost: /\b(?:re[ -]?upload|mirror|uploads?|archive|nightcore|sped\s*up)\b/iu.test(`${track.artist ?? ""} ${track.title}`),
  };
}

function familiesMatch(a: SongFamily, b: SongFamily) {
  if (a.id && a.id === b.id && a.provider === b.provider) return true;
  const sharedTitle = a.titles.find((title) => b.titles.includes(title));
  if (!sharedTitle) return false;
  if (a.artists.some((artist) => b.artists.includes(artist))) return true;
  // Unknown uploaders need stronger evidence than a short shared title.
  const nearDuration = a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) <= 2;
  const distinctive = sharedTitle.length >= 10 && sharedTitle.includes(" ");
  const longTitle = sharedTitle.length >= 17 && sharedTitle.split(" ").length >= 3;
  if (nearDuration && (a.repost || b.repost || (distinctive && a.provider !== b.provider) || longTitle)) return true;
  const comparable = a.duration > 0 && b.duration > 0 && Math.max(a.duration, b.duration) <= Math.min(a.duration, b.duration) * 1.45;
  return distinctive && comparable && (a.version || b.version);
}

export function sameSongFamily(a: TrackSource, b: TrackSource) {
  return familiesMatch(songFamily(a), songFamily(b));
}

export function recommendationEdition(track: TrackSource): number {
  return pitchEdit.test(track.title) ? 2 : songFamily(track).version ? 1 : 0;
}

/** Keep one version of a song for automatic listening. */
export function uniqueRecommendations<T extends TrackSource>(tracks: readonly T[], excluded: readonly TrackSource[] = []): T[] {
  const seen = excluded.map(songFamily);
  return tracks.filter((track) => {
    const candidate = songFamily(track);
    if (seen.some((previous) => familiesMatch(previous, candidate))) return false;
    seen.push(candidate);
    return true;
  });
}
