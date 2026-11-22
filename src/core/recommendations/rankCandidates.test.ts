import { describe, it, expect } from "vitest";
import type { Track } from "../types";
import { scoreCandidate, rankCandidates } from "./rankCandidates";
import { sameRecording, sameSongFamily, uniqueRecommendations } from "../recordings/matching";

const seed: Track = {
  id: "seed",
  provider: "youtube",
  uri: "u",
  title: "Ocean Eyes",
  artist: "Billie Eilish",
  duration: 210,
};

let n = 0;
function t(partial: Partial<Track> & { title: string }): Track {
  return { id: `t${n++}`, provider: "youtube", uri: "u", ...partial };
}

describe("scoreCandidate", () => {
  it("ranks a same-artist candidate higher than unrelated", () => {
    const sameArtist = t({ title: "Bored", artist: "Billie Eilish" });
    const unrelated = t({ title: "Skibidi", artist: "Random Band" });
    expect(scoreCandidate(seed, sameArtist)).toBeGreaterThan(scoreCandidate(seed, unrelated));
  });

  it("prefers full-playback providers", () => {
    const yt = t({ title: "Bored", artist: "Billie Eilish", provider: "youtube" });
    const sc = t({ title: "Bored", artist: "Billie Eilish", provider: "soundcloud" });
    const other = t({ title: "Bored", artist: "Billie Eilish", provider: "deezer" });
    const ytScore = scoreCandidate(seed, yt);
    const scScore = scoreCandidate(seed, sc);
    expect(scScore).toBe(ytScore);
    expect(scoreCandidate(seed, other)).toBeLessThan(ytScore);
  });

  it("prefers plausible song durations over near-zero length", () => {
    const good = t({ title: "Bored", artist: "Billie Eilish", duration: 180 });
    const zero = t({ title: "Bored", artist: "Billie Eilish", duration: 5 });
    expect(scoreCandidate(seed, good)).toBeGreaterThan(scoreCandidate(seed, zero));
  });
});

describe("rankCandidates", () => {
  it("filters a disliked recording family including edited reposts and explains the surviving picks", () => {
    const disliked = t({ title: "Bored", artist: "Billie Eilish", duration: 190 });
    const edit = t({ title: "Bored (sped up)", artist: "Billie Eilish", duration: 153, provider: "soundcloud" });
    const other = t({ title: "My Future", artist: "Billie Eilish", duration: 208 });
    const result = rankCandidates(seed, [disliked, edit, other], 12, {
      strict: true, annotate: true, feedback: { more: [], less: [disliked] },
    });
    expect(result.map((track) => track.title)).toEqual([other.title]);
    expect(result[0]?.meta?.recommendationReason).toBe("artist");
  });

  it("keeps the best copy when same track appears from multiple providers", () => {
    const weak = t({ title: "Ocean Eyes", artist: "Billie Eilish", duration: 190, provider: "deezer" });
    const strong = t({ title: "Ocean Eyes", artist: "Billie Eilish", duration: 210, provider: "youtube" });
    const out = rankCandidates(seed, [weak, strong]);
    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe("youtube");
  });

  it("caps output at limit and orders by descending score", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      t({ title: `Song ${i}`, artist: "X", duration: 100 + i }),
    );
    const out = rankCandidates(seed, items, 12);
    expect(out.length).toBeLessThanOrEqual(12);
  });
});

it("filters uploads and versions from recommendations while retaining exact recording identity", () => {
  const remix = t({ title: "Billie Eilish – Ocean Eyes (Another DJ's Remix)", artist: "Uploads", provider: "soundcloud" });
  const sped = t({ title: "Ocean Eyes (Sped Up + Nightcore)", artist: "Billie Eilish - Topic", duration: 168 });
  const clean = t({ title: "Ocean Eyes", artist: "Billie Eilish", duration: 210 });
  const repost = t({ title: "Ocean Eyes [Reupload]", artist: "Music Archive", provider: "soundcloud", duration: 209 });
  const uncredited = t({ title: "Ocean Eyes [Slowed + Reverb]", artist: "Different Account", duration: 249 });
  const samePlatform = t({ title: "A New Kind of Blue", artist: "First Account", provider: "soundcloud", duration: 184 });
  const anonymousCopy = t({ ...samePlatform, id: "copied", artist: "Second Account", duration: 185 });
  const topic = t({ title: "mansion", artist: "zombiqe - Topic", provider: "youtube", duration: 125 });
  const tagged = t({ title: "mansion", artist: "zombiqe #delsagate", provider: "soundcloud", duration: 124 });
  const other = t({ title: "Home", artist: "Someone Else", duration: 180 });
  const home = t({ title: "Home", artist: "Different Artist", provider: "soundcloud", duration: 180 });
  expect([remix, sped, repost, uncredited].every((track) => sameSongFamily(clean, track))).toBe(true);
  expect(sameSongFamily(samePlatform, anonymousCopy)).toBe(true);
  expect(sameSongFamily(topic, tagged)).toBe(true);
  expect(sameRecording(clean, sped)).toBe(false);
  expect(uniqueRecommendations([remix, sped, repost, home], [clean, other])).toEqual([home]);
  expect(rankCandidates(seed, [remix, sped, clean])).toEqual([clean]);
});

it("only fills from supported similarity and rejects known style conflicts and throwaway matches", () => {
  const anchor = { ...seed, genre: "shoegaze", meta: { tags: ["dream pop", "fuzz"] } };
  const style = t({ title: "Celestial Spine", artist: "New Artist", genre: "shoegaze" });
  const related = t({ title: "Untitled", artist: "Another Artist", meta: { relatedTo: anchor.id, relatedRank: 3 } });
  const wrong = t({ title: "Heavy Metal Anthem", artist: "Band", genre: "heavy metal", meta: { relatedTo: anchor.id } });
  const titleOnly = t({ title: "Ocean Eyes Forever", artist: "Random Band" });
  const alternate = t({ title: "Ocean Eyes (Slowed + Reverb)", artist: "Billie Eilish", genre: "shoegaze" });
  expect(rankCandidates(anchor, [wrong, titleOnly, alternate, related, style], 12, { strict: true, excluded: [anchor] }))
    .toEqual([style, related]);
  const favourite = t({ title: "Past tracks", artist: "First Pick", genre: "trip hop" });
  const fromTaste = t({ title: "New release", artist: "Unknown", genre: "trip hop" });
  expect(rankCandidates(anchor, [titleOnly, fromTaste], 12, { strict: true, taste: [favourite] })).toEqual([fromTaste]);
});
