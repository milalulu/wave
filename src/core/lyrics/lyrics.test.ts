import { describe, expect, it } from "vitest";
import { extractGeniusLyrics, parseSyncedLyrics } from "./LyricsService";

describe("parseSyncedLyrics", () => {
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

describe("extractGeniusLyrics", () => {
  it("извлекает текст из data-lyrics-container и декодирует сущности", () => {
    const html = `
      <div data-lyrics-container="true" class="Lyrics__Container">
        <a href="/x">First line</a><br/>
        It&apos;s a <b>second</b> line
      </div>
    `;
    expect(extractGeniusLyrics(html)).toBe("First line\nIt's a second line");
  });

  it("возвращает пустую строку без контейнера", () => {
    expect(extractGeniusLyrics("<html><body>no lyrics</body></html>")).toBe("");
  });
});
