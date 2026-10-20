import { beforeEach, expect, it, vi } from "vitest";
import type { AppServices } from "./compose";
import { ApiBridge } from "./bridge";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let handle: (event: { payload: { id: number; action: string; payload: unknown } }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    handle = callback as unknown as typeof handle;
    return () => {};
  });
});
const station = {
  artist: "Artist", tracks: [{ id: "1", provider: "youtube", uri: "1", title: "Song" }],
  similarArtists: ["Other"], seedTrackIds: [], generatedAt: 0,
};
const services = { engine: { snapshot: {} } } as unknown as AppServices;

it("artist radio over HTTP uses the same command as the interface", async () => {
  const startArtistRadio = vi.fn().mockResolvedValue(station);
  const bridge = new ApiBridge(services, { startArtistRadio, play: vi.fn() });
  await bridge.start();
  handle({ payload: { id: 1, action: "player.artistRadio", payload: { artist: "Artist" } } });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("api_respond", {
    id: 1, value: { ok: true, data: { artist: "Artist", count: 1, similarArtists: ["Other"] } },
  }));
  expect(startArtistRadio).toHaveBeenCalledWith("Artist");
});

it("failed or superseded radio requests return an error instead of empty success", async () => {
  const bridge = new ApiBridge(services, { startArtistRadio: vi.fn().mockResolvedValue(null), play: vi.fn() });
  await bridge.start();
  handle({ payload: { id: 2, action: "player.artistRadio", payload: { artist: "Artist" } } });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("api_respond", {
    id: 2, value: { ok: false, error: expect.stringContaining("superseded") },
  }));
});

it("HTTP playback uses the shared play command so pending radio is cancelled", async () => {
  const play = vi.fn().mockResolvedValue(undefined);
  const bridge = new ApiBridge(services, { startArtistRadio: vi.fn(), play });
  await bridge.start();
  handle({ payload: { id: 3, action: "player.play", payload: { queue: station.tracks } } });
  await vi.waitFor(() => expect(play).toHaveBeenCalledWith(station.tracks, 0));
});
