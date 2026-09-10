import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../types";
import {
  computeWrapped,
  drawWrappedCard,
  filterWrappedPeriod,
  type CardCtx,
} from "./wrapped";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 10, 12);

const entry = (title: string, artist: string, daysAgo: number, duration = 200): HistoryEntry => ({
  track: {
    id: `${artist}:${title}`,
    provider: "youtube",
    uri: "u",
    title,
    artist,
    duration,
  },
  playedAt: NOW - daysAgo * DAY,
});

describe("filterWrappedPeriod", () => {
  const entries = [entry("A", "X", 2), entry("B", "Y", 10), entry("C", "Z", 400)];
  it("режет по периодам", () => {
    expect(filterWrappedPeriod(entries, "week", NOW)).toHaveLength(1);
    expect(filterWrappedPeriod(entries, "month", NOW)).toHaveLength(2);
    expect(filterWrappedPeriod(entries, "year", NOW)).toHaveLength(2);
    expect(filterWrappedPeriod(entries, "all", NOW)).toHaveLength(3);
  });
});

describe("computeWrapped", () => {
  it("считает топы, минуты и дни", () => {
    const entries = [
      entry("S1", "ArtA", 0, 200),
      entry("S1", "ArtA", 0, 200),
      entry("S2", "ArtB", 1, 300),
    ];
    const s = computeWrapped(entries);
    expect(s.plays).toBe(3);
    expect(s.minutes).toBe(Math.round(700 / 60));
    expect(s.activeDays).toBe(2);
    expect(s.topArtists[0]).toMatchObject({ name: "ArtA", plays: 2 });
    expect(s.topTracks[0]).toMatchObject({ title: "S1", plays: 2 });
    expect(s.providers).toEqual([{ provider: "youtube", minutes: Math.round(700 / 60) }]);
  });

  it("считает стрик подряд идущих дней", () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const t = today.getTime();
    const mk = (daysAgo: number): HistoryEntry => ({
      track: { id: `x${daysAgo}`, provider: "youtube", uri: "u", title: "T", duration: 60 },
      playedAt: t - daysAgo * DAY,
    });
    expect(computeWrapped([mk(0), mk(1), mk(2)]).streakDays).toBe(3);
    expect(computeWrapped([mk(1), mk(2)]).streakDays).toBe(2);
    expect(computeWrapped([mk(0), mk(2)]).streakDays).toBe(1);
    expect(computeWrapped([]).streakDays).toBe(0);
  });

  it("пустая история даёт нули", () => {
    const s = computeWrapped([]);
    expect(s).toMatchObject({ plays: 0, minutes: 0, activeDays: 0, streakDays: 0 });
    expect(s.topArtists).toEqual([]);
  });
});

describe("drawWrappedCard", () => {
  function fakeCtx(): CardCtx & { texts: string[]; rects: { n: number } } {
    const texts: string[] = [];
    const rects = { n: 0 };
    return {
      canvas: { width: 1080, height: 1920 },
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      fillRect: () => {
        rects.n += 1;
      },
      fillText: (t: string) => {
        texts.push(t);
      },
      texts,
      rects,
    };
  }

  it("рисует заголовок, цифры и топы", () => {
    const ctx = fakeCtx();
    const s = computeWrapped([entry("S1", "ArtA", 0), entry("S2", "ArtB", 0)]);
    drawWrappedCard(ctx, s, "September");
    expect(ctx.texts).toContain("WAVE WRAPPED");
    expect(ctx.texts).toContain("September");
    expect(ctx.texts.some((t) => t.includes("ArtA"))).toBe(true);
    expect(ctx.texts.some((t) => t.includes("S1"))).toBe(true);
    expect(ctx.rects.n).toBeGreaterThan(0);
  });
});
