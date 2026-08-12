import { describe, expect, it } from "vitest";
import type { HistoryEntry, Track } from "../types";
import { WeightedRandomWaveSource } from "./WaveEngine";

const tracks: Track[] = [
  { id: "a", provider: "test", uri: "u://a", title: "A", genre: "rock" },
  { id: "b", provider: "test", uri: "u://b", title: "B", genre: "jazz" },
  { id: "c", provider: "test", uri: "u://c", title: "C", genre: "rock" },
];

describe("WeightedRandomWaveSource", () => {
  it("prefers liked tracks (highest weight)", () => {
    const source = new WeightedRandomWaveSource(() => 0.01);
    const ctx = {
      likedTracks: [tracks[0]],
      history: [{ track: tracks[1], playedAt: Date.now() }] as HistoryEntry[],
      libraryGenres: new Map<string, number>(),
      candidates: [tracks[2]],
    };
    const wave = source.generate(1, ctx);
    expect(wave[0].id).toBe("a");
  });

  it("boosts tracks from top genres of the library", () => {
    const source = new WeightedRandomWaveSource(() => 0.01);
    const ctx = {
      likedTracks: [],
      history: [{ track: tracks[2], playedAt: Date.now() }] as HistoryEntry[],
      libraryGenres: new Map([["rock", 10]]),
      candidates: [],
    };
    const wave = source.generate(1, ctx);
    expect(wave[0].id).toBe("c");
  });

  it("produces unique tracks up to the limit", () => {
    const source = new WeightedRandomWaveSource();
    const ctx = {
      likedTracks: tracks,
      history: [] as HistoryEntry[],
      libraryGenres: new Map<string, number>(),
      candidates: [],
    };
    const wave = source.generate(10, ctx);
    expect(wave).toHaveLength(3);
    expect(new Set(wave.map((t) => t.id)).size).toBe(3);
  });

  it("skips recently played tracks", () => {
    const source = new WeightedRandomWaveSource();
    const ctx = {
      likedTracks: tracks,
      history: [] as HistoryEntry[],
      libraryGenres: new Map<string, number>(),
      candidates: [],
      recentIds: new Set(["a", "b"]),
    };
    const wave = source.generate(10, ctx);
    expect(wave.map((t) => t.id)).toEqual(["c"]);
  });
});
