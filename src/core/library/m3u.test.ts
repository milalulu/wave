import { describe, expect, it } from "vitest";
import { buildM3U, localPathFromUri, localUri, parseM3U } from "./m3u";
import type { Track } from "../types";

describe("m3u", () => {
  it("buildM3U генерирует EXTINF с длительностью и артистом", () => {
    const track: Track = {
      id: "local:/music/a.mp3",
      provider: "local",
      uri: localUri("/music/a.mp3"),
      title: "Song",
      artist: "Artist",
      duration: 210,
    };
    const m3u = buildM3U([track]);
    expect(m3u).toBe("#EXTM3U\n#EXTINF:210,Artist - Song\n/music/a.mp3");
  });

  it("parseM3U восстанавливает треки из пути", () => {
    const text = "#EXTM3U\n#EXTINF:210,Artist - Song\n/music/a.mp3\n#EXTINF:-1,Instr\n/music/b.flac\n";
    const tracks = parseM3U(text);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: "local:/music/a.mp3",
      provider: "local",
      uri: "asset://localhost/music/a.mp3",
      title: "Song",
      artist: "Artist",
      duration: 210,
    });
    expect(tracks[1].title).toBe("Instr");
    expect(tracks[1].duration).toBeUndefined();
  });

  it("localUri / localPathFromUri — roundtrip", () => {
    expect(localPathFromUri(localUri("/home/user/my song.mp3"))).toBe("/home/user/my song.mp3");
    expect(localPathFromUri("https://example.com/x")).toBeNull();
  });

  it("localPathFromUri: Windows convertFileSrc (http://asset.localhost)", () => {
    expect(
      localPathFromUri("http://asset.localhost/C%3A%5CUsers%5Cme%5CMusic%5Csong.mp3"),
    ).toBe("C:\\Users\\me\\Music\\song.mp3");
  });

  it("localPathFromUri: Android convertFileSrc (http://asset.localhost, %2F)", () => {
    expect(
      localPathFromUri("http://asset.localhost/%2Fstorage%2Femulated%2F0%2FMusic%2Fsong.mp3"),
    ).toBe("/storage/emulated/0/Music/song.mp3");
  });

  it("parseM3U оставляет http://asset.localhost строки как есть", () => {
    const tracks = parseM3U(
      "#EXTM3U\nhttp://asset.localhost/C%3A%5CUsers%5Cme%5CMusic%5Csong.mp3",
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].uri).toBe(
      "http://asset.localhost/C%3A%5CUsers%5Cme%5CMusic%5Csong.mp3",
    );
  });
});
