import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { scoreTransition, applyTransitionPenalty } from "./transitionScoring";

function makeTrack(id: string, opts: { bpm?: number; tags?: string[]; year?: number } = {}): Track {
  return {
    id,
    provider: "test",
    uri: `u://${id}`,
    title: `Track ${id}`,
    meta: { bpm: opts.bpm, tags: opts.tags },
    year: opts.year,
  };
}

describe("scoreTransition", () => {
  it("returns 0.5 for all missing meta (no BPM, no tags, no year)", () => {
    const s = scoreTransition(makeTrack("a"), makeTrack("b"));
    expect(s.bpmFit).toBe(0.5);
    expect(s.tagOverlap).toBe(0.5);
    expect(s.eraFit).toBe(0.5);
    expect(s.total).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.3 + 0.5 * 0.2, 4);
  });

  it("BPM fit is 1.0 when within 10%", () => {
    const s = scoreTransition(makeTrack("a", { bpm: 100 }), makeTrack("b", { bpm: 105 }));
    expect(s.bpmFit).toBe(1.0);
  });

  it("BPM fit penalizes >10% diff", () => {
    const s = scoreTransition(makeTrack("a", { bpm: 100 }), makeTrack("b", { bpm: 150 }));
    expect(s.bpmFit).toBeLessThan(0.8);
  });

  it("BPM fit is 0.5 when one track lacks BPM", () => {
    const s = scoreTransition(makeTrack("a", { bpm: 100 }), makeTrack("b"));
    expect(s.bpmFit).toBe(0.5);
  });

  it("tag overlap is high with identical tags", () => {
    const tags = ["rock", "indie", "alt"];
    const s = scoreTransition(makeTrack("a", { tags }), makeTrack("b", { tags: [...tags] }));
    expect(s.tagOverlap).toBe(1.0);
  });

  it("tag overlap is 0 when no common tags", () => {
    const s = scoreTransition(
      makeTrack("a", { tags: ["rock"] }),
      makeTrack("b", { tags: ["jazz"] }),
    );
    expect(s.tagOverlap).toBe(0);
  });

  it("era fit is 1.0 when years within 15", () => {
    const s = scoreTransition(makeTrack("a", { year: 2000 }), makeTrack("b", { year: 2010 }));
    expect(s.eraFit).toBe(1.0);
  });

  it("era fit penalizes large year gaps", () => {
    const s = scoreTransition(makeTrack("a", { year: 1980 }), makeTrack("b", { year: 2020 }));
    expect(s.eraFit).toBeLessThan(1.0);
  });

  it("era fit ignores shared subgenre penalty", () => {
    const tags = ["indie", "alt"];
    const s = scoreTransition(
      makeTrack("a", { year: 1980, tags }),
      makeTrack("b", { year: 2020, tags: [...tags] }),
    );
    expect(s.eraFit).toBe(1.0);
  });

  it("total weights: bpm*0.5 + tag*0.3 + era*0.2", () => {
    const s = scoreTransition(
      makeTrack("a", { bpm: 100, tags: ["rock"], year: 2000 }),
      makeTrack("b", { bpm: 100, tags: ["rock"], year: 2005 }),
    );
    expect(s.total).toBeCloseTo(s.bpmFit * 0.5 + s.tagOverlap * 0.3 + s.eraFit * 0.2, 4);
  });
});

describe("applyTransitionPenalty", () => {
  it("returns 0 when score < 0.2 (drop)", () => {
    const w = applyTransitionPenalty(10, { bpmFit: 0, tagOverlap: 0, eraFit: 0, total: 0.15 });
    expect(w).toBe(0);
  });

  it("returns weight*0.4 when score < 0.4", () => {
    const w = applyTransitionPenalty(10, { bpmFit: 0, tagOverlap: 0, eraFit: 0, total: 0.35 });
    expect(w).toBe(4);
  });

  it("returns full weight when score >= 0.4", () => {
    const w = applyTransitionPenalty(10, { bpmFit: 0, tagOverlap: 0, eraFit: 0, total: 0.5 });
    expect(w).toBe(10);
  });

  it("returns 0 at exact boundary 0.2", () => {
    const w = applyTransitionPenalty(10, { bpmFit: 0, tagOverlap: 0, eraFit: 0, total: 0.2 });
    expect(w).toBe(4);
  });

  it("returns weight*0.4 at exact boundary 0.4", () => {
    const w = applyTransitionPenalty(10, { bpmFit: 0, tagOverlap: 0, eraFit: 0, total: 0.4 });
    expect(w).toBe(10);
  });
});
