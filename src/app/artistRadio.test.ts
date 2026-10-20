import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "./compose";
import type { MusicProvider } from "../core/providers/MusicProvider";

vi.mock("./compose", () => ({ radioTracks: vi.fn().mockResolvedValue([]) }));
import { buildArtistRadioStation, nextArtistRadioTracks } from "./artistRadio";
import { radioTracks } from "./compose";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const track = { id: "yt", provider: "youtube", uri: "https://example.org/audio", title: "Song", artist: "Artist" };
function services(providers: Partial<MusicProvider>[]) {
  return { providers } as AppServices;
}

it("a stalled provider does not prevent a playable station from other providers", async () => {
  vi.useFakeTimers();
  const result = buildArtistRadioStation(services([
    { id: "youtube", getArtistTopTracks: async () => [track] },
    { id: "stalled", getArtistTopTracks: () => new Promise(() => {}) },
  ]), "Artist");
  await vi.advanceTimersByTimeAsync(10_001);
  expect((await result).tracks).toEqual([track]);
});

it("cancellation stops waiting and prevents later discovery requests", async () => {
  const controller = new AbortController();
  const result = buildArtistRadioStation(services([
    { getArtistTopTracks: () => new Promise(() => {}) },
  ]), "Artist", 20, controller.signal);
  const rejected = expect(result).rejects.toThrow("cancelled");
  controller.abort();
  await rejected;
  expect(radioTracks).not.toHaveBeenCalled();
});

it("continuation discovers from the current song and excludes queued recordings across providers", async () => {
  const next = { ...track, id: "next", title: "Next song" };
  vi.mocked(radioTracks).mockResolvedValueOnce([
    { ...track, id: "another-source", provider: "soundcloud" }, next,
  ]);
  const app = { engine: { snapshot: { current: track, queue: [track] } } } as unknown as AppServices;
  const station = { artist: "Artist", tracks: [track], similarArtists: [], seedTrackIds: [], generatedAt: 0 };
  expect(await nextArtistRadioTracks(app, station)).toEqual([next]);
  expect(radioTracks).toHaveBeenCalledWith(app, track);
});
