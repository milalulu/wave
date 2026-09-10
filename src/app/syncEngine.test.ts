// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregisterAll: vi.fn(),
}));

const fetchRemoteLikesMock = vi.fn();
const fetchRemotePlaylistsMock = vi.fn();
const fetchRemoteSettingsMock = vi.fn();
const fetchSharedPlaylistsMock = vi.fn();
const fetchPlaybackStateMock = vi.fn();
const syncPlaybackStateMock = vi.fn();

vi.mock("./supabase", () => ({
  fetchRemoteLikes: (...args: unknown[]) => fetchRemoteLikesMock(...args),
  fetchRemotePlaylists: (...args: unknown[]) => fetchRemotePlaylistsMock(...args),
  fetchRemoteSettings: (...args: unknown[]) => fetchRemoteSettingsMock(...args),
  fetchSharedPlaylists: (...args: unknown[]) => fetchSharedPlaylistsMock(...args),
  fetchPlaybackState: (...args: unknown[]) => fetchPlaybackStateMock(...args),
  syncPlaybackState: (...args: unknown[]) => syncPlaybackStateMock(...args),
  syncLikes: vi.fn(),
  syncPlaylists: vi.fn(),
  syncSettings: vi.fn(),
  getCurrentUser: vi.fn(async () => ({ id: "u1" })),
  isSupabaseConfigured: true,
}));

import { useApp } from "./stores";
import { pullRemoteData, shouldOfferContinue } from "./syncEngine";
import type { SyncedPlaylist } from "./supabase";

const remotePlaylist = (id: string, name: string, updatedAt: number): SyncedPlaylist => ({
  id,
  name,
  trackIds: ["x"],
  tracks: [{ id: "x", provider: "test", uri: "u://x", title: "X", updatedAt: 1 }],
  createdAt: 1,
  updatedAt,
});

afterEach(() => {
  useApp.setState({ playlists: [], likedIds: new Set() });
  vi.restoreAllMocks();
});

beforeEach(() => {
  fetchRemoteLikesMock.mockResolvedValue([]);
  fetchRemotePlaylistsMock.mockResolvedValue([]);
  fetchRemoteSettingsMock.mockResolvedValue(null);
  fetchSharedPlaylistsMock.mockResolvedValue([]);
  fetchPlaybackStateMock.mockResolvedValue(null);
});

describe("pullRemoteData", () => {
  it("merges remote playlists that do not exist locally", async () => {
    useApp.setState({ playlists: [], likedIds: new Set() });
    fetchRemotePlaylistsMock.mockResolvedValue([remotePlaylist("r1", "Remote", 100)]);
    await pullRemoteData("u1");
    const playlists = useApp.getState().playlists;
    expect(playlists.map((p) => p.id)).toEqual(["r1"]);
    expect(playlists[0].name).toBe("Remote");
  });

  it("keeps the newer version of an existing playlist", async () => {
    useApp.setState({
      playlists: [{ id: "p1", name: "Old", trackIds: ["a"], tracks: [], createdAt: 1, updatedAt: 100 }],
      likedIds: new Set(),
    });
    fetchRemotePlaylistsMock.mockResolvedValue([remotePlaylist("p1", "New", 200)]);
    await pullRemoteData("u1");
    expect(useApp.getState().playlists[0].name).toBe("New");
    expect(useApp.getState().playlists[0].updatedAt).toBe(200);
  });

  it("does not overwrite a locally newer playlist", async () => {
    useApp.setState({
      playlists: [{ id: "p1", name: "Local", trackIds: ["a"], tracks: [], createdAt: 1, updatedAt: 300 }],
      likedIds: new Set(),
    });
    fetchRemotePlaylistsMock.mockResolvedValue([remotePlaylist("p1", "Remote", 200)]);
    await pullRemoteData("u1");
    expect(useApp.getState().playlists[0].name).toBe("Local");
  });

  it("unions remote likes with local ones", async () => {
    useApp.setState({ playlists: [], likedIds: new Set(["a"]) });
    fetchRemoteLikesMock.mockResolvedValue([
      { trackId: "b", track: { id: "b", provider: "test", uri: "u://b", title: "B", updatedAt: 1 }, createdAt: 1 },
    ]);
    await pullRemoteData("u1");
    expect([...useApp.getState().likedIds].sort()).toEqual(["a", "b"]);
  });
});

describe("shouldOfferContinue", () => {
  const remoteTrack = (id: string) => ({
    id,
    provider: "youtube",
    uri: `u://${id}`,
    title: `T ${id}`,
  });
  const remote = (trackId: string, updatedAt: number, queue = ["a", "b"]) => ({
    track: remoteTrack(trackId),
    queue: queue.map((q) => remoteTrack(q)),
    index: 0,
    position: 42,
    updatedAt,
  });

  it("предлагает свежий чужой трек", () => {
    expect(shouldOfferContinue(remote("b", Date.now() + 1000), "a", Date.now())).toBe(true);
  });

  it("молчит если трек тот же, очередь пуста или состояние старое", () => {
    const now = Date.now();
    expect(shouldOfferContinue(remote("a", now + 1000), "a", now)).toBe(false);
    expect(shouldOfferContinue(remote("b", now + 1000, []), null, now)).toBe(false);
    expect(shouldOfferContinue(remote("b", now - 1000), null, now)).toBe(false);
    expect(shouldOfferContinue(null, null, now)).toBe(false);
  });

  it("pull предлагает продолжить через notify", async () => {
    useApp.setState({ playlists: [], likedIds: new Set() });
    const notified: { message: string; action?: { label: string; run: () => void } }[] = [];
    useApp.setState({
      notify: ((message: string, action?: { label: string; run: () => void }) => {
        notified.push({ message, action });
      }) as never,
    });
    fetchPlaybackStateMock.mockResolvedValue(remote("b", Date.now() + 10000));
    await pullRemoteData("u1");
    expect(notified.length).toBe(1);
    expect(typeof notified[0].action?.run).toBe("function");
  });

  it("pull молчит без удалённого состояния", async () => {
    useApp.setState({ playlists: [], likedIds: new Set() });
    const notified: string[] = [];
    useApp.setState({ notify: ((m: string) => void notified.push(m)) as never });
    fetchPlaybackStateMock.mockResolvedValue(null);
    await pullRemoteData("u1");
    expect(notified).toEqual([]);
  });
});
