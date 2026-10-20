import { describe, it, expect } from "vitest";
import type { Track } from "../types";
import {
  assembleArtistStation,
  artistSeedTrack,
  normalizeArtistName,
} from "./artistRadio";

let n = 0;
function t(partial: Partial<Track> & { title: string; artist?: string }): Track {
  return {
    id: `t${n++}`,
    provider: "youtube",
    uri: "u",
    artist: "Test Artist",
    ...partial,
  };
}

describe("normalizeArtistName", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeArtistName("  Daft   Punk ")).toBe("Daft Punk");
  });
});

describe("artistSeedTrack", () => {
  it("builds a stable virtual seed", () => {
    const seed = artistSeedTrack("Daft Punk");
    expect(seed.artist).toBe("Daft Punk");
    expect(seed.id).toBe("artist-radio:daft punk");
  });
});

describe("assembleArtistStation", () => {
  it("throws on empty artist", () => {
    expect(() => assembleArtistStation("  ", [], [])).toThrow();
  });

  it("dedupes same artist::title and drops virtual seeds", () => {
    const a1 = t({ title: "One", artist: "Daft Punk", provider: "youtube" });
    const a2 = t({ title: "One", artist: "Daft Punk", provider: "deezer" });
    const seed = artistSeedTrack("Daft Punk");
    const out = assembleArtistStation("Daft Punk", [a1, a2, seed], []);
    // rankCandidates схлопывает дубликаты в один
    expect(out.tracks).toHaveLength(1);
  });

  it("prefers same-artist tracks and caps limit", () => {
    const same = Array.from({ length: 10 }, (_, i) =>
      t({ title: `Track ${i}`, artist: "Daft Punk" }),
    );
    const other = Array.from({ length: 10 }, (_, i) =>
      t({ title: `Other ${i}`, artist: "Random Band" }),
    );
    const out = assembleArtistStation("Daft Punk", [...other, ...same], [], [], 5);
    expect(out.tracks).toHaveLength(5);
    // хотя бы большинство — тот же артист
    const sameCount = out.tracks.filter((x) => x.artist === "Daft Punk").length;
    expect(sameCount).toBeGreaterThanOrEqual(3);
  });

  it("cleans similar artists list", () => {
    const tracks = [t({ title: "One", artist: "Daft Punk" })];
    const out = assembleArtistStation(
      "Daft Punk",
      tracks,
      ["Daft Punk", "  Justice ", "Justice", "Kavinsky"],
    );
    expect(out.similarArtists).toEqual(["Justice", "Kavinsky"]);
  });
});
