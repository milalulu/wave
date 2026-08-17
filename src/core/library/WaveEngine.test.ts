import { describe, expect, it } from "vitest";
import type { HistoryEntry, Track } from "../types";
import { SmartWaveSource, WaveEngine, WeightedRandomWaveSource } from "./WaveEngine";
import { MemoryStorage } from "../database/MemoryStorage";

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

describe("SmartWaveSource", () => {
  const picker = (values: number[]) => {
    let i = 0;
    return () => values[i++] ?? 0.5;
  };

  it("recomputes the artist penalty from the base weight instead of compounding it", () => {
    const xs = [
      { id: "x1", provider: "test", uri: "u://x1", title: "X1", artist: "X" },
      { id: "x2", provider: "test", uri: "u://x2", title: "X2", artist: "X" },
      { id: "x3", provider: "test", uri: "u://x3", title: "X3", artist: "X" },
    ];
    const y = { id: "y1", provider: "test", uri: "u://y1", title: "Y1", artist: "Y" };
    const source = new SmartWaveSource(picker([0.1, 0.1, 0.1, 0.9]));
    const ctx = {
      likedTracks: [...xs, y],
      history: [] as HistoryEntry[],
      libraryGenres: new Map<string, number>(),
      candidates: [],
    };
    const wave = source.generate(4, ctx);
    
    
    expect(wave.map((t) => t.id)).toEqual(["x1", "x2", "x3", "y1"]);
  });

  it("limits consecutive picks from the same artist", () => {
    const same = tracks.map((t, i) => ({ ...t, id: `a${i}`, artist: "Same" }));
    const other = { id: "o", provider: "test", uri: "u://o", title: "O", artist: "Other" };
    const source = new SmartWaveSource();
    const ctx = {
      likedTracks: [...same, other],
      history: [] as HistoryEntry[],
      libraryGenres: new Map<string, number>(),
      candidates: [],
    };
    const wave = source.generate(10, ctx);
    expect(new Set(wave.map((t) => t.artist))).toEqual(new Set(["Same", "Other"]));
  });
});

describe("WaveEngine", () => {
  it("markPlayed excludes the played track from the next wave", async () => {
    const storage = new MemoryStorage();
    for (const t of tracks) await storage.addLikedTrack(t);
    const engine = new WaveEngine(storage, [], new WeightedRandomWaveSource());
    engine.markPlayed(tracks[0]);
    const wave = await engine.generateWave(10);
    expect(wave.map((t) => t.id)).not.toContain("a");
  });
});
