import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { RollingContext } from "./RollingContext";

function makeTrack(id: string, bpm?: number, tags?: string[], year?: number): Track {
  return {
    id,
    provider: "test",
    uri: `u://${id}`,
    title: `Track ${id}`,
    meta: { bpm, tags },
    year,
  };
}

describe("RollingContext", () => {
  it("starts with empty window", () => {
    const ctx = new RollingContext();
    expect(ctx.getWindow()).toHaveLength(0);
    expect(ctx.getSeed()).toBeNull();
  });

  it("setSeed stores seed and clears window", () => {
    const ctx = new RollingContext();
    ctx.addPlayed(makeTrack("a"));
    ctx.addPlayed(makeTrack("b"));
    ctx.setSeed(makeTrack("s"));
    expect(ctx.getSeed()?.id).toBe("s");
    expect(ctx.getWindow()).toHaveLength(0);
  });

  it("addPlayed maintains max window size of 5", () => {
    const ctx = new RollingContext();
    for (let i = 0; i < 8; i++) {
      ctx.addPlayed(makeTrack(`t${i}`));
    }
    expect(ctx.getWindow()).toHaveLength(5);
    expect(ctx.getWindow()[0].id).toBe("t3");
    expect(ctx.getWindow()[4].id).toBe("t7");
  });

  it("removeLast pops the last entry", () => {
    const ctx = new RollingContext();
    ctx.addPlayed(makeTrack("a"));
    ctx.addPlayed(makeTrack("b"));
    ctx.removeLast();
    expect(ctx.getWindow()).toHaveLength(1);
    expect(ctx.getWindow()[0].id).toBe("a");
  });

  it("removeLast is no-op on empty window", () => {
    const ctx = new RollingContext();
    ctx.removeLast();
    expect(ctx.getWindow()).toHaveLength(0);
  });

  it("getWeightedFeatures returns empty defaults when empty", () => {
    const ctx = new RollingContext();
    const f = ctx.getWeightedFeatures();
    expect(f.bpm).toBe(0);
    expect(f.tags.size).toBe(0);
    expect(f.mood).toBe("");
    expect(f.year).toBe(0);
  });

  it("computes weighted BPM favoring recent tracks", () => {
    const ctx = new RollingContext();
    ctx.addPlayed(makeTrack("old", 80));
    ctx.addPlayed(makeTrack("mid", 100));
    ctx.addPlayed(makeTrack("new", 120));
    const f = ctx.getWeightedFeatures();
    expect(f.bpm).toBeGreaterThan(90);
    expect(f.bpm).toBeLessThan(120);
  });

  it("weighted BPM includes seed with 0.2 weight", () => {
    const ctx = new RollingContext();
    ctx.setSeed(makeTrack("seed", 100));
    ctx.addPlayed(makeTrack("a", 60));
    ctx.addPlayed(makeTrack("b", 60));
    ctx.addPlayed(makeTrack("c", 60));
    ctx.addPlayed(makeTrack("d", 60));
    const f = ctx.getWeightedFeatures();
    expect(f.bpm).toBeLessThan(100);
  });

  it("collects tags from all tracks with weights", () => {
    const ctx = new RollingContext();
    ctx.addPlayed(makeTrack("a", 100, ["rock", "classic"]));
    ctx.addPlayed(makeTrack("b", 100, ["rock", "alt"]));
    const f = ctx.getWeightedFeatures();
    expect(f.tags.get("rock")).toBeGreaterThan(0);
    expect(f.tags.get("classic")).toBeGreaterThan(0);
  });

  it("weighted average year favors recent tracks", () => {
    const ctx = new RollingContext();
    ctx.addPlayed(makeTrack("old", undefined, undefined, 1990));
    ctx.addPlayed(makeTrack("new", undefined, undefined, 2020));
    const f = ctx.getWeightedFeatures();
    expect(f.year).toBeGreaterThan(1990);
    expect(f.year).toBeLessThanOrEqual(2020);
  });
});
