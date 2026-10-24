// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
  isTauri: vi.fn(() => true),
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
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregisterAll: vi.fn(),
}));

import { useApp } from "./stores";
import { createDesktopAgentSession } from "./agentDesktop";
import { MemoryStorage } from "../core/database/MemoryStorage";
import { LibraryService } from "../core/library/LibraryService";
import { PlayerEngine } from "../core/player/PlayerEngine";
import { MockAudioAdapter } from "../core/player/PlayerAdapter";
import type { AppServices } from "./compose";
import type { ToolArguments, ToolName, ToolResult, ToolResults } from "../core/agent/contract";
import type { AgentExecutor } from "../core/agent/AgentExecutor";
import { AGENT_TOOLS } from "../core/agent/catalog";
import type { Track } from "../core/types";
import { invoke } from "@tauri-apps/api/core";

const original = useApp.getState();
const tracks: Track[] = [
  { id: "local:/private/song-a", title: "Orbit", artist: "Paper Moons", provider: "youtube", uri: "asset:///private/a", duration: 180, meta: { token: "secret" } },
  { id: "track:b", title: "Harbor", artist: "Paper Moons", provider: "youtube", uri: "asset:///private/b", duration: 240 },
];
const allowedTools = Object.keys(AGENT_TOOLS) as ToolName[];
let storage: MemoryStorage;
let adapter: MockAudioAdapter;
let engine: PlayerEngine;
let services: AppServices;
let session: AgentExecutor;
let sequence: number;
const provider = () => ({ id: "youtube", name: "test",
  search: vi.fn().mockResolvedValue({ provider: "youtube", tracks, albums: [], artists: [] }),
  resolveUri: async (track: Track) => track.uri,
  getAlbum: async () => { throw new Error("not used"); },
  getArtist: async () => { throw new Error("not used"); },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
async function run<K extends ToolName>(name: K, args: ToolArguments[K], id = `call:${++sequence}`, signal?: AbortSignal): Promise<ToolResult<K>> {
  return session.execute(id, { type: "tool", name, args }, { allowedTools, signal }) as Promise<ToolResult<K>>;
}
async function data<K extends ToolName>(name: K, args: ToolArguments[K]): Promise<ToolResults[K]> {
  const result = await run(name, args);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
async function found() { return (await data("wave_search", { query: "Paper Moons", limit: 10 })).tracks; }

beforeEach(() => {
  localStorage.clear(); sequence = 0;
  storage = new MemoryStorage(); adapter = new MockAudioAdapter(); engine = new PlayerEngine(adapter);
  services = { engine, storage, library: new LibraryService(storage), providers: [provider()] } as unknown as AppServices;
  useApp.setState({ ...original, services, snapshot: engine.snapshot, agentSession: null, playlists: [], likedIds: new Set(), radioActive: false, notices: [] });
  for (const event of ["state", "track", "queue", "volume", "speed", "equalizer", "shuffle", "repeat"] as const) {
    engine.on(event, () => useApp.setState({ snapshot: engine.snapshot }));
  }
  session = createDesktopAgentSession(services, useApp.getState);
});
afterEach(() => {
  session.dispose(); useApp.getState().closeAgentSession(); engine.destroy();
  useApp.setState({ ...original, services: null }); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("desktop agent execution", () => {
  it("searches without playing and exposes only session IDs and public metadata", async () => {
    const result = await found();
    expect(result).toHaveLength(2);
    expect(result[0].id).not.toBe(tracks[0].id);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|asset:/);
    expect(engine.snapshot.queue).toEqual([]);
    expect((await run("wave_play", { trackId: tracks[0].id })).ok).toBe(false);
    await data("wave_play", { trackId: result[0].id });
    expect(adapter.state).toBe("playing");
    expect(engine.snapshot.current?.id).toBe(tracks[0].id);
  });

  it("executes playback controls and settings through the real engine and UI actions", async () => {
    await data("wave_play", { trackId: (await found())[0].id });
    await data("wave_volume", { percent: 23 });
    await data("wave_seek", { positionSeconds: 45 });
    await data("wave_pause", {});
    expect(adapter.position).toBe(45); expect(adapter.state).toBe("paused");
    await data("wave_resume", {});
    await data("wave_shuffle", { enabled: true });
    await data("wave_repeat", { mode: "one" });
    await data("wave_speed", { rate: 1.25 });
    await data("wave_equalizer", { gainsDb: [3, 0, 0, 0, 0, 0, 0, 0, 0, -2] });
    const s = await data("wave_status", {});
    expect(s).toMatchObject({ state: "playing", positionSeconds: 45, volumePercent: 23, shuffle: true, repeat: "one", speed: 1.25 });
    expect(adapter.volume).toBe(0.23); expect(adapter.equalizer[0]).toBe(3);
    expect(useApp.getState().snapshot.volume).toBe(0.23);
  });

  it("preserves playback when enqueueing, including an empty queue", async () => {
    const [a, b] = await found();
    await data("wave_queue_add", { trackId: a.id, position: "next" });
    expect(adapter.state).toBe("idle");
    await data("wave_resume", {});
    await data("wave_queue_add", { trackId: b.id, position: "next" });
    expect(engine.snapshot.current?.id).toBe(tracks[0].id);
    const queue = await data("wave_queue", { offset: 1, limit: 1 });
    expect(queue.items[0].title).toBe("Harbor");
    await data("wave_next", {}); expect(engine.snapshot.current?.id).toBe(tracks[1].id);
    await data("wave_previous", {}); expect(engine.snapshot.current?.id).toBe(tracks[0].id);
    await data("wave_queue_clear", {}); expect(engine.snapshot.queue).toEqual([]);
  });

  it("creates and populates playlists once, refreshes UI and sets likes idempotently", async () => {
    const [a] = await found();
    const create = { type: "tool", name: "wave_playlist_create", args: { name: "Focus" } };
    const [first, retry] = await Promise.all([session.execute("same", create, { allowedTools }), session.execute("same", create, { allowedTools })]);
    expect(first).toEqual(retry);
    const list = await data("wave_playlists", { offset: 0, limit: 10 });
    expect(list.items).toHaveLength(1);
    const playlistId = list.items[0].id;
    expect((await data("wave_playlist_add", { playlistId, trackId: a.id })).added).toBe(true);
    expect((await data("wave_playlist_add", { playlistId, trackId: a.id })).added).toBe(false);
    expect(useApp.getState().playlists[0].trackIds).toEqual([tracks[0].id]);
    expect((await data("wave_playlist_get", { playlistId, offset: 0, limit: 10 })).items).toHaveLength(1);
    await data("wave_playlist_play", { playlistId });
    await data("wave_like", { trackId: a.id, liked: true });
    await data("wave_like", { trackId: a.id, liked: true });
    expect((await data("wave_liked", { offset: 0, limit: 10 })).items).toHaveLength(1);
    expect(useApp.getState().likedIds.has(tracks[0].id)).toBe(true);
    await data("wave_like", { trackId: a.id, liked: false });
    expect(useApp.getState().likedIds.size).toBe(0);
    await data("wave_queue_clear", {});
    expect(await storage.getPlaylists()).toHaveLength(1);
  });

  it("checks deleted playlists and blocked sources again at execution time", async () => {
    const [a] = await found();
    const pl = await data("wave_playlist_create", { name: "Gone" });
    await storage.removePlaylist((await storage.getPlaylists())[0].id);
    expect(await run("wave_playlist_play", { playlistId: pl.id })).toMatchObject({ ok: false, error: { code: "not_found" } });
    localStorage.setItem("wave-blocked-providers", JSON.stringify(["youtube"]));
    expect(await run("wave_play", { trackId: a.id })).toMatchObject({ ok: false, error: { code: "not_playable" } });
  });

  it("rejects invalid arguments, unknown tools and actions outside the trusted allowlist", async () => {
    expect(await session.execute("bad", { type: "tool", name: "shell", args: {} }, { allowedTools })).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
    expect(await session.execute("bad", { type: "tool", name: "wave_volume", args: { percent: 200 } }, { allowedTools })).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
    expect(await session.execute("no", { type: "tool", name: "wave_volume", args: { percent: 0 } }, { allowedTools: ["wave_status"] })).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(adapter.volume).toBe(1);
    await run("wave_volume", { percent: 20 }, "conflict");
    expect(await run("wave_volume", { percent: 30 }, "conflict")).toMatchObject({ ok: false, error: { code: "request_conflict" } });
    expect(adapter.volume).toBe(0.2);
  });

  it("distinguishes empty search, partial provider failures and total failure without leaking errors", async () => {
    services.providers = [provider(), { ...provider(), search: vi.fn().mockRejectedValue(new Error("secret-token")) }];
    expect((await data("wave_search", { query: "Paper Moons", limit: 10 })).incomplete).toBe(true);
    services.providers = [{ ...provider(), search: vi.fn().mockResolvedValue({ provider: "youtube", tracks: [], artists: [], albums: [] }) }];
    expect((await data("wave_search", { query: "missing", limit: 10 })).tracks).toEqual([]);
    services.providers = [{ ...provider(), search: vi.fn().mockRejectedValue(new Error("secret-token")) }];
    const failure = await run("wave_search", { query: "missing", limit: 10 });
    expect(failure).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
    expect(JSON.stringify(failure)).not.toContain("secret-token");
  });

  it("does not report playback success when the audio adapter fails", async () => {
    const [a] = await found();
    vi.spyOn(adapter, "play").mockRejectedValue(new Error("private stream URL"));
    expect(await run("wave_play", { trackId: a.id })).toMatchObject({ ok: false, error: { code: "playback_failed" } });
  });

  it("bounds seeking against current duration and rejects resume without a queue", async () => {
    expect(await run("wave_resume", {})).toMatchObject({ ok: false, error: { code: "empty_queue" } });
    await data("wave_play", { trackId: (await found())[0].id });
    expect(await run("wave_seek", { positionSeconds: 181 })).toMatchObject({ ok: false, error: { code: "out_of_range" } });
    expect(adapter.position).toBe(0);
  });

  it("cancels a search before it can publish references or trigger playback", async () => {
    const pending = deferred<{ provider: string; tracks: Track[]; artists: never[]; albums: never[] }>();
    services.providers = [{ ...provider(), search: () => pending.promise }];
    const controller = new AbortController();
    const result = run("wave_search", { query: "Paper Moons", limit: 5 }, "search", controller.signal);
    await Promise.resolve(); controller.abort();
    expect(await result).toMatchObject({ ok: false, error: { code: "cancelled", effect: "not_started" } });
    pending.resolve({ provider: "youtube", tracks, artists: [], albums: [] });
    expect((await data("wave_status", {})).current).toBeNull();
  });

  it.each([false, true])("cancels stream resolution without letting a late stream start (synchronous=%s)", async (synchronous) => {
    const pending = deferred<string>();
    engine.destroy(); engine = new PlayerEngine(adapter, { resolveUri: () => pending.promise });
    services.engine = engine; session.dispose(); session = createDesktopAgentSession(services, useApp.getState);
    const id = (await found())[0].id;
    const controller = new AbortController();
    if (synchronous) engine.on("state", (state) => { if (state === "loading") controller.abort(); });
    const result = run("wave_play", { trackId: id }, "play", controller.signal);
    if (!synchronous) {
      await vi.waitFor(() => expect(engine.snapshot.state).toBe("loading"));
      controller.abort();
    }
    expect(await result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    pending.resolve("asset:///late");
    await data("wave_status", {});
    expect(adapter.state).not.toBe("playing");
  });

  it("keeps the library identity while playing a preferred recording source", async () => {
    services.recordings = { resolve: (track: Track) => ({ ...track, playbackSource: { ...track, id: "alternate", uri: "asset:///alternate" } }) } as AppServices["recordings"];
    await data("wave_play", { trackId: (await found())[0].id });
    expect(adapter.src).toBe("asset:///alternate");
    expect(engine.snapshot.current?.id).toBe(tracks[0].id);
  });

  it("uses the radio controller and reports its actual state", async () => {
    useApp.setState({ startArtistRadio: async (artist) => {
      await engine.playTracks(tracks);
      return { artist, tracks, similarArtists: [], seedTrackIds: [], generatedAt: 0 };
    } });
    expect(await data("wave_radio", { artist: "Paper Moons" })).toMatchObject({ artist: "Paper Moons", trackCount: 2, state: "playing" });
  });

  it("checks the native platform before opening a session and closes it explicitly", async () => {
    await expect(useApp.getState().openAgentSession()).rejects.toThrow("unavailable");
    vi.stubGlobal("__WAVE_DESKTOP_AGENT__", true);
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await expect(useApp.getState().openAgentSession()).rejects.toThrow("unavailable");
    vi.mocked(invoke).mockResolvedValue(true);
    const opened = await useApp.getState().openAgentSession();
    expect(await useApp.getState().openAgentSession()).toBe(opened);
    useApp.getState().closeAgentSession();
    expect(await opened.execute("closed", { type: "tool", name: "wave_status", args: {} }, { allowedTools })).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
});
