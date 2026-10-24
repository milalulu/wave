// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./artistRadio", () => ({
  buildArtistRadioStation: vi.fn(),
  nextArtistRadioTracks: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({}),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ listen: vi.fn().mockResolvedValue(() => {}) })),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregisterAll: vi.fn(),
}));

import { useApp } from "./stores";
import { buildArtistRadioStation, nextArtistRadioTracks } from "./artistRadio";
import { assembleArtistStation } from "../core/radio/artistRadio";

const builder = vi.mocked(buildArtistRadioStation);
const station = (artist: string) => ({
  artist,
  tracks: [{ id: artist, provider: "youtube", uri: artist, title: "Song", artist }],
  similarArtists: [],
  seedTrackIds: [],
  generatedAt: 0,
});
let engine: { playTracks: ReturnType<typeof vi.fn>; setAutoFill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  useApp.getState().cancelArtistRadio();
  builder.mockReset();
  engine = { playTracks: vi.fn().mockResolvedValue(undefined), setAutoFill: vi.fn() };
  useApp.setState({
    services: { engine } as unknown as import("./compose").AppServices,
    artistRadioState: { status: "idle", artist: "", station: null, error: null },
    radioActive: false,
    notices: [],
    view: "home",
    navStack: ["home"],
  });
});

it("a later artist selection stays active when an older request finishes", async () => {
  let resolveA!: (value: ReturnType<typeof station>) => void;
  let resolveB!: (value: ReturnType<typeof station>) => void;
  builder
    .mockImplementationOnce(() => new Promise((r) => { resolveA = r; }))
    .mockImplementationOnce(() => new Promise((r) => { resolveB = r; }));
  const first = useApp.getState().startArtistRadio("Artist A");
  await vi.waitFor(() => expect(builder).toHaveBeenCalledTimes(1));
  const second = useApp.getState().startArtistRadio("Artist B");
  await vi.waitFor(() => expect(builder).toHaveBeenCalledTimes(2));
  resolveB(station("Artist B"));
  await second;
  resolveA(station("Artist A"));
  await first;
  expect(useApp.getState().artistRadioState.artist).toBe("Artist B");
});

it("retry repeats the requested artist after an initial failure", async () => {
  builder.mockRejectedValueOnce(new Error("provider unavailable"))
    .mockResolvedValueOnce(station("Artist A"));
  await useApp.getState().startArtistRadio("Artist A");
  await useApp.getState().refreshArtistRadio();
  expect(builder).toHaveBeenCalledTimes(2);
});

it("station ranking keeps the full stream instead of an earlier preview", () => {
  const preview = {
    id: "preview", provider: "itunes", uri: "preview", title: "Song",
    artist: "Artist A", duration: 30,
  };
  const full = { ...preview, id: "full", provider: "youtube", uri: "full", duration: 240 };
  const result = assembleArtistStation("Artist A", [preview, full], []);
  expect(result.tracks[0].id).toBe("full");
});

it("normal playback cancels a pending station without later replacing its queue", async () => {
  let resolve!: (value: ReturnType<typeof station>) => void;
  builder.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const pending = useApp.getState().startArtistRadio("Artist A");
  await vi.waitFor(() => expect(builder).toHaveBeenCalledTimes(1));
  const signal = builder.mock.calls[0][3];
  await useApp.getState().play(station("Other").tracks);
  expect(signal?.aborted).toBe(true);
  resolve(station("Artist A"));
  await pending;
  expect(engine.playTracks).toHaveBeenCalledTimes(1);
  expect(engine.playTracks).toHaveBeenLastCalledWith(station("Other").tracks, 0);
});

it("playing a station row keeps radio mode and the entire station queue", async () => {
  const generated = station("Artist A");
  generated.tracks.push({ ...generated.tracks[0], id: "second", title: "Second" });
  builder.mockResolvedValue(generated);
  await useApp.getState().startArtistRadio("Artist A");
  await useApp.getState().playArtistRadio(1);
  expect(useApp.getState().radioActive).toBe(true);
  expect(engine.playTracks).toHaveBeenLastCalledWith(generated.tracks, 1);
});

it("a stale rejection does not overwrite a newer station or its status", async () => {
  let reject!: (error: Error) => void;
  builder.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }))
    .mockResolvedValueOnce(station("Artist B"));
  const first = useApp.getState().startArtistRadio("Artist A");
  await vi.waitFor(() => expect(builder).toHaveBeenCalledTimes(1));
  await useApp.getState().startArtistRadio("Artist B");
  reject(new Error("old error"));
  await first;
  expect(useApp.getState().artistRadioState).toMatchObject({ status: "ready", artist: "Artist B", error: null });
  expect(useApp.getState().radioActive).toBe(true);
});

it("failed playback clears radio autofill and preserves the artist for retry", async () => {
  builder.mockResolvedValue(station("Artist A"));
  engine.playTracks.mockRejectedValueOnce(new Error("audio failure"));
  await useApp.getState().startArtistRadio("Artist A");
  expect(useApp.getState().artistRadioState).toMatchObject({ status: "error", artist: "Artist A" });
  expect(useApp.getState().radioActive).toBe(false);
  await useApp.getState().refreshArtistRadio();
  expect(useApp.getState().artistRadioState.status).toBe("ready");
});

it("a late autofill result cannot extend a queue after leaving the station", async () => {
  builder.mockResolvedValue(station("Artist A"));
  let resolve!: (tracks: ReturnType<typeof station>["tracks"]) => void;
  vi.mocked(nextArtistRadioTracks).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await useApp.getState().startArtistRadio("Artist A");
  const calls = engine.setAutoFill.mock.calls;
  const fill = calls[calls.length - 1][0] as () => Promise<unknown[]>;
  const pending = fill();
  await useApp.getState().play(station("Other").tracks);
  resolve(station("Artist A").tracks);
  expect(await pending).toEqual([]);
});

it("an external abort cancels station preparation without replacing playback", async () => {
  let finish!: (value: ReturnType<typeof station>) => void;
  builder.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = useApp.getState().startArtistRadio("Artist A", controller.signal);
  await vi.waitFor(() => expect(builder).toHaveBeenCalledOnce());
  controller.abort();
  expect(builder.mock.calls[0][3]?.aborted).toBe(true);
  finish(station("Artist A"));
  expect(await pending).toBeNull();
  expect(engine.playTracks).not.toHaveBeenCalled();
  expect(useApp.getState().artistRadioState.status).toBe("idle");
});
