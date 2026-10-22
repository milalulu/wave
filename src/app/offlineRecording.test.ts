// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { localUriFor, registerDownload } from "./offline";
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
const track = { id: "a", provider: "first", uri: "u://a", title: "Song", artist: "Artist", duration: 200 };
beforeEach(() => localStorage.clear());
it("does not substitute a downloaded live version or another artist", () => {
  registerDownload("live.mp3", "Artist", "Song (Live)", "live");
  registerDownload("other.mp3", "Other", "Song", "other");
  registerDownload("unknown.mp3", undefined, "Song", "unknown");
  expect(localUriFor(track)).toBeNull();
});
it("matches another source only with compatible title, artist and duration", () => {
  registerDownload("long.mp3", "Artist", "Song", "long", "second", undefined, undefined, 230);
  expect(localUriFor(track)).toBeNull();
  registerDownload("same.mp3", "Artist", "Song (Official Audio)", "same", "second", undefined, undefined, 202);
  expect(localUriFor(track)).toBe("asset://same.mp3");
});
it("finds the explicitly chosen source by its source ID", () => {
  registerDownload("selected.mp3", undefined, undefined, "selected", "second");
  expect(localUriFor({ ...track, playbackSource: { ...track, id: "selected", provider: "second" } })).toBe("asset://selected.mp3");
});
