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

vi.mock("./supabase", () => ({
  fetchRemoteLikes: (...args: unknown[]) => fetchRemoteLikesMock(...args),
  fetchRemotePlaylists: (...args: unknown[]) => fetchRemotePlaylistsMock(...args),
  fetchRemoteSettings: (...args: unknown[]) => fetchRemoteSettingsMock(...args),
  fetchSharedPlaylists: (...args: unknown[]) => fetchSharedPlaylistsMock(...args),
  syncLikes: vi.fn(),
  syncPlaylists: vi.fn(),
  syncSettings: vi.fn(),
  getCurrentUser: vi.fn(async () => ({ id: "u1" })),
  isSupabaseConfigured: true,
}));

import { useApp } from "./stores";
import { pullRemoteData } from "./syncEngine";
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
