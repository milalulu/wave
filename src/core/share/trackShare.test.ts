import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { shareText, shareableUrl } from "./trackShare";

const base: Track = { id: "x", provider: "youtube", uri: "", title: "Song", artist: "Artist" };

describe("trackShare", () => {
  it("берёт ссылку на трек SoundCloud из метаданных", () => {
    const t: Track = { ...base, provider: "soundcloud", meta: { scUrl: "https://soundcloud.com/artist/song" } };
    expect(shareText(t)).toBe("Artist — Song\nhttps://soundcloud.com/artist/song");
  });

  it("берёт youtube watch из uri", () => {
    const t: Track = { ...base, uri: "https://www.youtube.com/watch?v=abc123" };
    expect(shareableUrl(t)).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("без ссылки шарит только текст", () => {
    const t: Track = { ...base, uri: "soundcloud:track:42" };
    expect(shareableUrl(t)).toBeNull();
    expect(shareText(t)).toBe("Artist — Song");
  });

  it("без артиста не оставляет висячий разделитель", () => {
    const t: Track = { ...base, artist: undefined };
    expect(shareText(t)).toBe("Song");
  });
});
