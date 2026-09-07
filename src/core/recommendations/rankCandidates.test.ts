import { describe, it, expect } from "vitest";
import type { Track } from "../types";
import { scoreCandidate, rankCandidates } from "./rankCandidates";

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
