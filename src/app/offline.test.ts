import { describe, expect, it } from "vitest";
import { needsStreamResolve } from "./offline";

describe("needsStreamResolve", () => {
  it("возвращает true для страниц watch/track", () => {
    expect(needsStreamResolve("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(needsStreamResolve("https://music.youtube.com/watch?v=abc123")).toBe(true);
    expect(needsStreamResolve("https://youtu.be/abc123")).toBe(true);
    expect(needsStreamResolve("https://soundcloud.com/artist/track")).toBe(true);
    expect(needsStreamResolve("https://open.spotify.com/track/abc")).toBe(true);
  });

  it("возвращает false для прямых медиа-URL", () => {
    expect(needsStreamResolve("https://cf-media.sndcdn.com/x.mp3")).toBe(false);
    expect(needsStreamResolve("https://audio-ssl.itunes.apple.com/preview.m4a")).toBe(false);
    expect(needsStreamResolve("https://rr1---sn.googlevideo.com/videoplayback?expire=1")).toBe(false);
    expect(needsStreamResolve("https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A42")).toBe(false);
    expect(needsStreamResolve("")).toBe(false);
  });
});
