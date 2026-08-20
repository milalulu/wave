// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { useApp } from "./stores";
import type { Track } from "../core/types";

afterEach(() => {
  useApp.setState({
    view: "home",
    navStack: ["home"],
    playlists: [],
    selectedPlaylistId: null,
    notices: [],
    logs: [],
    theme: "dark",
    compactPlayer: false,
    sleepUntil: null,
    sleepRemaining: 0,
    pauseAfterTrack: false,
    snapshot: {
      state: "idle",
      current: null,
      position: 0,
      duration: 0,
      volume: 1,
      speed: 1,
       equalizer: [],
       bassBoost: 0,
       reverb: 0,
       stereoWidth: 0,
       shuffle: false,
      repeat: "off",
      queue: [],
      queueIndex: -1,
      history: [],
    },
  });
});

const track = (id: string, title: string, artist = "Artist"): Track => ({
  id,
  title,
  uri: `uri://${id}`,
  artist,
  album: "Album",
  duration: 180,
  provider: "deezer",
  coverUrl: "",
});

describe("navigation", () => {
  it("setView switches the current view", () => {
    useApp.setState({ view: "home" });
    useApp.getState().setView("album");
    expect(useApp.getState().view).toBe("album");
  });

  it("pushes sub-views onto the navigation stack and resets it on tabs", () => {
    useApp.setState({ view: "home", navStack: ["home"] });
    const { setView } = useApp.getState();
    setView("album");
    setView("artist");
    expect(useApp.getState().navStack).toEqual(["home", "album", "artist"]);
    setView("library");
    expect(useApp.getState().navStack).toEqual(["library"]);
    expect(useApp.getState().view).toBe("library");
  });

  it("does not duplicate the current top view", () => {
    useApp.setState({ view: "home", navStack: ["home"] });
    useApp.getState().setView("queue");
    useApp.getState().setView("queue");
    expect(useApp.getState().navStack).toEqual(["home", "queue"]);
  });

  it("goBack pops the stack and returns to the previous view", () => {
    useApp.setState({ view: "home", navStack: ["home"] });
    const { setView, goBack } = useApp.getState();
    setView("album");
    setView("artist");
    goBack();
    expect(useApp.getState().view).toBe("album");
    expect(useApp.getState().navStack).toEqual(["home", "album"]);
    goBack();
    expect(useApp.getState().view).toBe("home");
    expect(useApp.getState().navStack).toEqual(["home"]);
  });

  it("goBack is a no-op at the root tab", () => {
    useApp.setState({ view: "home", navStack: ["home"] });
    useApp.getState().goBack();
    expect(useApp.getState().view).toBe("home");
    expect(useApp.getState().navStack).toEqual(["home"]);
  });

  it("goBack clears the detail of the view being left", () => {
    useApp.setState({ view: "home", navStack: ["home"], albumDetail: { album: { id: "a" } } as never });
    useApp.getState().setView("album");
    useApp.getState().goBack();
    expect(useApp.getState().view).toBe("home");
    expect(useApp.getState().albumDetail).toBeNull();
  });

  it("clearDetail resets album and artist details", () => {
    useApp.setState({ view: "album" });
    useApp.getState().clearDetail();
    expect(useApp.getState().albumDetail).toBeNull();
    expect(useApp.getState().artistDetail).toBeNull();
  });
});

describe("queue", () => {
  it("setSelectedPlaylist tracks selection", () => {
    useApp.setState({ selectedPlaylistId: null });
    useApp.getState().setSelectedPlaylist("pl-1");
    expect(useApp.getState().selectedPlaylistId).toBe("pl-1");
  });

  it("reorderPlaylist moves a track and persists trackIds", () => {
    const tracks = [track("a", "A"), track("b", "B"), track("c", "C")];
    useApp.setState({
      playlists: [
        {
          id: "pl-1",
          name: "Mix",
          trackIds: ["a", "b", "c"],
          tracks,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useApp.getState().reorderPlaylist("pl-1", 0, 2);
    const pl = useApp.getState().playlists[0];
    expect(pl.tracks?.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(pl.trackIds).toEqual(["b", "c", "a"]);
  });

  it("reorderPlaylist ignores out-of-range moves", () => {
    const tracks = [track("a", "A"), track("b", "B")];
    useApp.setState({
      playlists: [
        {
          id: "pl-1",
          name: "Mix",
          trackIds: ["a", "b"],
          tracks,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useApp.getState().reorderPlaylist("pl-1", 0, 5);
    expect(useApp.getState().playlists[0].tracks?.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("notices and logs", () => {
  it("notify adds a notice and a log entry", () => {
    useApp.getState().notify("hello");
    expect(useApp.getState().notices).toHaveLength(1);
    expect(useApp.getState().notices[0].message).toBe("hello");
    expect(useApp.getState().logs[0].message).toBe("hello");
  });

  it("dismissNotice removes a specific notice", () => {
    useApp.setState({ notices: [{ id: 1, message: "a" }, { id: 2, message: "b" }] });
    useApp.getState().dismissNotice(1);
    expect(useApp.getState().notices.map((n) => n.id)).toEqual([2]);
  });

  it("clearLogs empties the log buffer", () => {
    useApp.setState({ logs: [{ time: 1, message: "x" }] });
    useApp.getState().clearLogs();
    expect(useApp.getState().logs).toEqual([]);
  });
});

describe("settings toggles", () => {
  it("setTheme stores the theme", () => {
    useApp.getState().setTheme("light");
    expect(useApp.getState().theme).toBe("light");
  });

  it("setCompactPlayer toggles compact mode", () => {
    useApp.setState({ compactPlayer: false });
    useApp.getState().setCompactPlayer(true);
    expect(useApp.getState().compactPlayer).toBe(true);
  });

  it("sleep controls update state", () => {
    useApp.getState().setSleepMinutes(30);
    expect(useApp.getState().sleepUntil).toBeGreaterThan(0);
    useApp.getState().setSleepAfterTrack();
    expect(useApp.getState().pauseAfterTrack).toBe(true);
    useApp.getState().clearSleep();
    expect(useApp.getState().sleepUntil).toBeNull();
    expect(useApp.getState().pauseAfterTrack).toBe(false);
  });

  it("autoContinue and offline mode persist", () => {
    useApp.getState().setAutoContinue(true);
    expect(useApp.getState().autoContinue).toBe(true);
    useApp.getState().setOfflineMode(true);
    expect(useApp.getState().offlineMode).toBe(true);
  });

  it("excludePreviews включён по умолчанию и переключается", () => {
    expect(useApp.getState().excludePreviews).toBe(true);
    useApp.getState().setExcludePreviews(false);
    expect(useApp.getState().excludePreviews).toBe(false);
    useApp.getState().setExcludePreviews(true);
    expect(useApp.getState().excludePreviews).toBe(true);
  });
});

describe("no-op actions without services", () => {
  it("playback actions do not throw before init", async () => {
    const { play, togglePlay, next, previous } = useApp.getState();
    await expect(play([track("a", "A")], 0)).resolves.toBeUndefined();
    await expect(togglePlay()).resolves.toBeUndefined();
    await expect(next()).resolves.toBeUndefined();
    await expect(previous()).resolves.toBeUndefined();
  });
});
