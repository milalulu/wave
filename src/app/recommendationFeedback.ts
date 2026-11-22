import type { Track } from "../core/types";
import { sameSongFamily } from "../core/recordings/matching";

const KEY = "wave:recommendation-feedback";
const LIFETIME = 30 * 86400000;
type Entry = { track: Track; direction: "more" | "less"; time: number };
let entries: Entry[] | undefined;

function current() {
  if (!entries) {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      entries = Array.isArray(raw) ? raw.filter((entry): entry is Entry =>
        typeof entry?.track?.id === "string" && typeof entry.track.title === "string"
        && (entry.direction === "more" || entry.direction === "less") && Number.isFinite(entry.time)) : [];
    } catch { entries = []; }
  }
  return entries.filter((entry) => Date.now() - entry.time < LIFETIME);
}

export function setRecommendationFeedback(track: Track, direction: Entry["direction"]) {
  const { id, title, artist, genre, duration, provider, uri } = track;
  entries = [{ track: { id, title, artist, genre, duration, provider, uri, meta: {
    tags: track.meta?.tags, creditedArtist: track.meta?.creditedArtist,
  } }, direction, time: Date.now() }, ...current().filter((old) => !sameSongFamily(old.track, track))].slice(0, 60);
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* Keep in-session feedback. */ }
}

export function getRecommendationFeedback() {
  const feedback = current();
  return { more: feedback.filter((entry) => entry.direction === "more").map(({ track }) => track),
    less: feedback.filter((entry) => entry.direction === "less").map(({ track }) => track) };
}
