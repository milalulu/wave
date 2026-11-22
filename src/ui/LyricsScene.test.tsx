// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricsScene } from "./LyricsScene";
import { directLyrics, lyricsLook, moodGlyphs, reactions, type LyricsMood } from "./lyricsDirection";
import { particleCount, sampleParticle } from "./lyricsMotion";
import { activeAtmospheres, planAtmospheres } from "./lyricsAtmosphere";

afterEach(cleanup);

it("separates atmospheric words from intimate motifs and keeps timed effects across line changes", () => {
  const lines = [
    { text: "Дождь и слёзы", time: 1, words: [{ text: "Дождь ", time: 2, end: 3 }, { text: "и слёзы", time: 3, end: 3.6 }] },
    { text: "Без снега, лишь тишина", time: 4 },
    { text: "Метель", time: 6 },
    { text: "Океан", time: 10 },
    { text: "Листопад", time: 15 },
  ];
  const direction = directLyrics("weather", lines);
  expect(direction[0].map(({ motif }) => motif)).toEqual(["downpour", "tears"]);
  expect(direction[1].map(({ motif }) => motif)).toEqual([undefined, "whisper"]);
  const schedule = planAtmospheres(lines, direction);
  expect(schedule.map(({ kind, time }) => [kind, time])).toEqual([["rain", 2], ["snow", 6], ["ocean", 10], ["leaves", 15]]);
  expect(activeAtmospheres(schedule, 1.9)).toEqual([]);
  expect(activeAtmospheres(schedule, 4.3).map(({ kind }) => kind)).toEqual(["rain"]);
  expect(activeAtmospheres(schedule, 10.4).map(({ kind }) => kind)).toEqual(["snow", "ocean"]);
  expect(activeAtmospheres(schedule, 22)).toEqual([]);
});

it("cycles every reaction for a repeated word and recognizes distinct motifs", () => {
  const lines = Array.from({ length: 7 }, () => ({ text: "Люблю дождь!" }));
  const cues = directLyrics("chorus", lines);
  expect(new Set(cues.slice(0, 6).map(([first]) => first.reaction)).size).toBe(reactions.length);
  expect(cues[6]).toEqual(cues[0]);
  expect(cues[0].map(({ mood }) => mood)).toEqual(["heart", "rain"]);
  expect(new Set([0, 8, 16, 24].map((index) => lyricsLook("chorus", index))).size).toBe(4);
});

it("recognizes additional word forms without matching substrings", () => {
  const cues = directLyrics("test", [
    { text: "Обнимаешь затмение" }, { text: "Ураганы и шёпотом" },
    { text: "Raindropper and embers" }, { text: "Созвездия, голограммы" },
  ]);
  expect(cues.map((line) => line.map(({ mood }) => mood))).toEqual([
    ["heart", "stars"], ["wind", "quiet"], ["fire"], ["stars", "code"],
  ]);
});

it("requires affectionate context for ambiguous forms of address", () => {
  const lines = [
    "Этот райдер пиздец дорогой",
    "Ломай мои запястья, сломай меня, родная",
    "Я люблю тебя, дорогой",
    "Не люблю тебя, родная",
    "Мне приснился родной дом",
    "Еду дорогой вдоль поля",
    "Родная, я скучаю по тебе",
    "Dear friends, I miss you",
    "Я плачу за квартиру",
    "Плачу, слёзы на глазах",
    "У них дресс-код",
  ];
  const cues = directLyrics("context", lines.map((text) => ({ text })));
  const words = cues.map((line, index) => line.map(({ start, end, mood }) => [lines[index].slice(start, end), mood]));
  expect(words).toEqual([
    [], [], [["люблю", "heart"], ["дорогой", "heart"]], [["люблю", "quiet"]],
    [["приснился", "quiet"]], [], [["Родная", "heart"]], [], [], [["Плачу", "rain"], ["слёзы", "rain"]], [],
  ]);
});

it.each(Object.keys(moodGlyphs) as LyricsMood[])("keeps six distinct %s variants in the word band", (mood) => {
  const signatures = reactions.map((reaction) => {
    const cue = { mood, reaction };
    const initial = Array.from({ length: particleCount }, (_, index) => sampleParticle(cue, index, 0));
    const final = Array.from({ length: particleCount }, (_, index) => sampleParticle(cue, index, 1));
    expect([...initial, ...final].every((point) => point.opacity === 0)).toBe(true);
    const frames = Array.from({ length: 21 }, (_, frame) =>
      Array.from({ length: particleCount }, (_, index) => sampleParticle(cue, index, frame / 20)));
    expect(frames.flat().every(({ x, y }) => x >= 7 && x <= 93 && y >= 16 && y <= 84)).toBe(true);
    return JSON.stringify(frames.map((frame) => frame.map(({ x, y }) => [x, y])));
  });
  expect(new Set(signatures).size).toBe(reactions.length);
});

it("moves rain down and sparks up as playback advances", () => {
  const lyrics = {
    trackId: "weather", title: "Weather", synced: true, instrumental: false, source: "local",
    lines: [{ text: "Rain and fire", time: 1, words: [
      { text: "Rain ", time: 1, end: 2 }, { text: "and ", time: 1.1, end: 2 },
      { text: "fire", time: 1.2, end: 2 },
    ] }],
  };
  const props = { lyrics, activeIndex: 0, seek: vi.fn(), preparing: "Intro" };
  const { container, rerender } = render(<LyricsScene {...props} position={1.45} />);
  const y = (mood: string) => parseFloat(container.querySelector<HTMLElement>(
    `[data-word-mood="${mood}"] .lyrics-particles i`,
  )!.style.getPropertyValue("--y"));
  const rain = y("rain");
  const fire = y("fire");
  rerender(<LyricsScene {...props} position={1.85} />);
  expect(y("rain")).toBeGreaterThan(rain);
  expect(y("fire")).toBeLessThan(fire);
});

it("cues two motifs on their own word timestamps", () => {
  const lyrics = {
    trackId: "duet", title: "Duet", synced: true, instrumental: false, source: "local",
    lines: [{ text: "Fire and stars", time: 1, words: [
      { text: "Fire ", time: 1.2, end: 1.6 },
      { text: "and ", time: 1.7, end: 1.9 },
      { text: "stars", time: 2.4, end: 3 },
    ] }],
  };
  const { container, rerender } = render(<LyricsScene lyrics={lyrics} activeIndex={0} position={2} seek={vi.fn()} preparing="Intro" />);
  expect(container.querySelector("[data-word-mood='fire'] [data-reaction]")).toBeTruthy();
  expect(container.querySelector("[data-word-mood='stars'] [data-reaction]")).toBeNull();
  rerender(<LyricsScene lyrics={lyrics} activeIndex={0} position={2.5} seek={vi.fn()} preparing="Intro" />);
  expect(container.querySelector("[data-word-mood='stars'] [data-reaction]")).toBeTruthy();
});

it("holds back the next word until the actual word timing", () => {
  const lyrics = {
    trackId: "timed", title: "Timed", synced: true, instrumental: false, source: "local",
    lines: [{ text: "Hello world", time: 1, words: [
      { text: "Hello ", time: 1, end: 1.5 },
      { text: "world", time: 3, end: 4 },
    ] }],
  };
  const { container } = render(<LyricsScene lyrics={lyrics} activeIndex={0} position={2} seek={vi.fn()} preparing="Intro" />);
  const words = container.querySelectorAll<HTMLElement>(".lyrics-karaoke-word");
  expect(Array.from(words, (word) => word.style.getPropertyValue("--word-fill"))).toEqual(["100%", "0%"]);
});

it("anchors cues to the exact words within a grouped timing tag", () => {
  const lyrics = {
    trackId: "grouped", title: "Grouped", synced: true, instrumental: false, source: "local",
    lines: [{ text: "The rain and fire", time: 1, words: [
      { text: "  The rain and fire", time: 1, end: 4 },
    ] }],
  };
  const { container } = render(<LyricsScene lyrics={lyrics} activeIndex={0} position={2} seek={vi.fn()} preparing="Intro" />);
  const words = Array.from(container.querySelectorAll(".lyrics-scene-word"));
  expect(words.map((word) => word.querySelector(".lyrics-scene-word-ink")?.textContent)).toEqual(["rain", "fire"]);
  expect(words.map((word) => word.getAttribute("data-cued"))).toEqual(["true", "false"]);
});

it("keeps closing punctuation with the accent across timed chunks", () => {
  const lyrics = {
    trackId: "punctuation", title: "Punctuation", synced: true, instrumental: false, source: "local",
    lines: [{ text: "Солнце, ещё немного", time: 1, words: [
      { text: "Солнце", time: 1, end: 2 },
      { text: ", ещё немного", time: 2, end: 4 },
    ] }],
  };
  const { container } = render(<LyricsScene lyrics={lyrics} activeIndex={0} position={2.6} seek={vi.fn()} preparing="Intro" />);
  const unit = container.querySelector(".lyrics-scene-word-unit");
  expect(unit?.querySelector(".lyrics-scene-word-ink")?.textContent).toBe("Солнце");
  expect(unit?.lastElementChild?.textContent).toBe(",");
});

it("uses playback position for particles and lets listeners seek to the next line", () => {
  const lyrics = {
    trackId: "test", title: "Test", synced: true, instrumental: false, source: "test",
    lines: [{ text: "Я тебя люблю", time: 0 }, { text: "Я больше не люблю", time: 4 }],
  };
  const seek = vi.fn();
  const { container, rerender } = render(<LyricsScene lyrics={lyrics} activeIndex={0} position={0.5} seek={seek} preparing="Intro" />);
  const words = container.querySelectorAll<HTMLElement>(".lyrics-karaoke-word");
  expect(words[0].style.getPropertyValue("--word-fill")).toBe("100%");
  expect(words[2].style.getPropertyValue("--word-fill")).toBe("0%");
  expect(screen.queryByText("♥")).toBeNull();
  rerender(<LyricsScene lyrics={lyrics} activeIndex={0} position={2.8} seek={seek} preparing="Intro" />);
  expect(screen.getByRole("region").getAttribute("data-mood")).toBe("heart");
  expect(screen.getAllByText("♥")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button"));
  expect(seek).toHaveBeenCalledWith(4);
  rerender(<LyricsScene lyrics={lyrics} activeIndex={1} position={4.5} seek={seek} preparing="Intro" />);
  expect(screen.getByRole("region").getAttribute("data-mood")).toBe("quiet");
  expect(screen.queryByText("♥")).toBeNull();
  const outgoing = container.querySelector(".lyrics-scene-outgoing");
  expect(outgoing?.textContent).toBe("Я тебя люблю");
  expect(outgoing?.getAttribute("aria-hidden")).toBe("true");
  rerender(<LyricsScene lyrics={lyrics} activeIndex={1} position={4.9} seek={seek} preparing="Intro" />);
  expect(container.querySelector(".lyrics-scene-outgoing")).toBeNull();
});
