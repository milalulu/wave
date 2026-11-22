import { describe, expect, it, vi } from "vitest";
import { LyricsService, parseSyncedLyrics } from "./LyricsService";

describe("parseSyncedLyrics", () => {
  it("preserves enhanced LRC word intervals and hides timing tags", () => {
    expect(parseSyncedLyrics("[00:01.00]<00:01.00>Hello <00:02.50>world<00:03.00>")).toEqual([
      { time: 1, text: "Hello world", words: [
        { time: 1, end: 2.5, text: "Hello " },
        { time: 2.5, end: 3, text: "world" },
      ] },
    ]);
  });
  it("парсит тайминги mm:ss.xx", () => {
    const lrc = "[00:12.50]First line\n[00:15.00]Second line";
    const lines = parseSyncedLyrics(lrc);
    expect(lines).toEqual([
      { time: 12.5, text: "First line" },
      { time: 15, text: "Second line" },
    ]);
  });

  it("поддерживает несколько таймингов на строке", () => {
    const lrc = "[00:01.00][00:05.00]Repeated";
    expect(parseSyncedLyrics(lrc)).toEqual([
      { time: 1, text: "Repeated" },
      { time: 5, text: "Repeated" },
    ]);
  });

  it("игнорирует метаданные и пустые строки", () => {
    const lrc = "[ti:Title]\n[ar:Artist]\n\n[00:10.00]Real line\n";
    const lines = parseSyncedLyrics(lrc);
    expect(lines).toEqual([{ time: 10, text: "Real line" }]);
  });

  it("сортирует по времени", () => {
    const lrc = "[00:05.00]B\n[00:02.00]A";
    expect(parseSyncedLyrics(lrc).map((l) => l.text)).toEqual(["A", "B"]);
  });
});

describe("lyrics lookup", () => {
  const track = { id: "video", provider: "youtube", uri: "", artist: "Artist - Topic", title: "Artist - Song (Official Video)", duration: 180 };

  it("prefers LRCLIB Lyricsfile word timing over plain line timing", async () => {
    const json = vi.fn(async () => ({ status: 200, body: {
      trackName: "Artist - Song (Official Audio)", artistName: "Artist", duration: 180,
      hasWordSync: true, syncedLyrics: "[00:01]Sing slowly",
      lyricsfile: `version: "1.0"
lines:
  - text: Sing slowly
    start_ms: 1000
    end_ms: 5000
    words:
      - { text: Sing, start_ms: 1100, end_ms: 1500 }
      - { text: slowly, start_ms: 3000 }`,
    } }));
    const result = await new LyricsService({ json, text: vi.fn() }).getLyrics(track);
    expect(result.lines[0].words).toEqual([
      { text: "Sing", time: 1.1, end: 1.5 },
      { text: " slowly", time: 3, end: 5 },
    ]);
  });

  it("queries metadata from the same recording on another provider after a miss", async () => {
    const candidate = { ...track, id: "alternate", provider: "soundcloud", title: "Song", artist: "Artist", album: "Album", duration: 181 };
    const find = vi.fn(async () => [candidate]);
    const json = vi.fn(async (_method: string, url: string) => new URL(url).searchParams.get("album_name") === "Album"
      ? { status: 200, body: { trackName: "Song", artistName: "Artist", duration: 181, syncedLyrics: "[00:01]A line" } }
      : { status: 404, body: null });
    const service = new LyricsService({ json, text: vi.fn() }, find);
    const current = { ...track, title: "Song", artist: "Artist" };
    expect(await service.getLyrics(current)).toMatchObject({ trackId: "video", synced: true, lines: [{ time: 1, text: "A line" }] });
    expect(find).toHaveBeenCalledWith(current);
  });

  it("matches title credits on a reupload only when timed versions match", async () => {
    const json = vi.fn(async (_method: string, url: string) => {
      const request = new URL(url);
      if (request.searchParams.get("artist_name") !== "Artist") return { status: 404, body: null };
      return { status: 200, body: [
        { trackName: "Song", artistName: "Artist", duration: 185, syncedLyrics: "[00:01]Wrong" },
        { trackName: "Song", artistName: "Artist", duration: 181, syncedLyrics: "[00:01]Correct" },
      ] };
    });
    const result = await new LyricsService({ json, text: vi.fn() }).getLyrics({
      ...track, provider: "soundcloud", artist: "A fan account", title: "Artist -- Song (feat. Guest)",
    });
    expect(result.lines).toEqual([{ time: 1, text: "Correct" }]);
  });

  it("loads an imported LRC file after creating a fresh lyrics service", async () => {
    const http = { json: vi.fn(), text: vi.fn() };
    new LyricsService(http).importLocalLyrics({ ...track, id: "offline-file" }, "[00:01]A line");
    try {
      const result = await new LyricsService(http).getLyrics({ ...track, id: "offline-file" });
      expect(result).toMatchObject({ source: "local", synced: true, lines: [{ time: 1, text: "A line" }] });
      expect(http.json).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem("wave:lyrics:offline-file");
    }
  });

  it("cleans video packaging and rejects a mismatched recording before preferring synced lyrics", async () => {
    const json = vi.fn(async (_method: string, url: string) => {
      const request = new URL(url);
      expect(request.searchParams.get("track_name")).toBe("Song");
      expect(request.searchParams.get("artist_name")).toBe("Artist");
      return request.pathname.endsWith("/get") ? { status: 404, body: null } : { status: 200, body: [
        { trackName: "Song", artistName: "Other", duration: 180, syncedLyrics: "[00:01]Wrong artist" },
        { trackName: "Song", artistName: "Artist", duration: 220, syncedLyrics: "[00:01]Wrong version" },
        { trackName: "Song", artistName: "Artist", duration: 180, syncedLyrics: "[00:01]Correct" },
      ] };
    });
    const result = await new LyricsService({ json, text: vi.fn() }).getLyrics(track);
    expect(result.lines).toEqual([{ time: 1, text: "Correct" }]);
    expect(result.synced).toBe(true);
  });

  it("retries a miss later and retains remix metadata", async () => {
    let available = false;
    const json = vi.fn(async (_method: string, url: string) => {
      const request = new URL(url);
      if (request.hostname !== "lrclib.net") return { status: 404, body: null };
      expect(request.searchParams.get("track_name")).toBe("Song (Remix)");
      if (!available) return { status: 404, body: null };
      return { status: 200, body: { trackName: "Song (Remix)", artistName: "Artist", duration: 180, plainLyrics: "A line" } };
    });
    const service = new LyricsService({ json, text: vi.fn() });
    const remix = { ...track, title: "Artist - Song (Remix)" };
    expect((await service.getLyrics(remix)).lines).toEqual([]);
    available = true;
    expect((await service.getLyrics(remix)).lines).toEqual([{ text: "A line" }]);
  });
});
