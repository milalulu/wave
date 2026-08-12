import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AlbumDetail, ArtistDetail, Playlist, PlayerSnapshot, RepeatMode, Track } from "../core/types";
import type { LyricsResult } from "../core/lyrics/LyricsService";
import { composeServices, type AppServices } from "./compose";
import { ApiBridge } from "./bridge";
import { bindMediaSession } from "./mediaSession";
import { clearRestore, loadRestore, saveRestore } from "./queueRestore";
import { loadSavedEqualizer, saveEqualizer } from "./equalizerStore";
import { loadSavedSpeed, saveSpeed } from "./speedStore";
import { loadTheme, saveTheme, applyTheme, type Theme } from "./themeStore";
import { sendNowPlayingNotification } from "./notifications";
import { getCachedCover } from "../core/cover/CoverCache";
import { t } from "../core/i18n";
import {
  accentFromImage,
  applyAccent,
  isAccentEnabled as isAccentEnabledPersist,
  loadSavedAccent,
  saveAccent,
  setAccentEnabled as persistAccentEnabled,
} from "../core/cover/accent";

let initPromise: Promise<void> | null = null;

interface AppState {
  services: AppServices | null;
  ready: boolean;
  snapshot: PlayerSnapshot;
  likedIds: string[];
  localTracks: Track[];
  notices: { id: number; message: string }[];
  notify: (message: string) => void;
  dismissNotice: (id: number) => void;
  view: "home" | "search" | "library" | "queue" | "wave" | "album" | "artist" | "playlist";
  setView: (v: AppState["view"]) => void;
  albumDetail: AlbumDetail | null;
  artistDetail: ArtistDetail | null;
  loadAlbum: (providerId: string, albumId: string) => Promise<void>;
  loadArtist: (providerId: string, artistId: string) => Promise<void>;
  clearDetail: () => void;
  playlists: Playlist[];
  selectedPlaylistId: string | null;
  setSelectedPlaylist: (id: string | null) => void;
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string, tracks?: Track[]) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  init: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  play: (tracks: Track[], index?: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (percent: number) => void;
  setSpeed: (rate: number) => void;
  setEqualizer: (gains: number[]) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => void;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  toggleLike: (track?: Track) => Promise<void>;
  startWave: () => Promise<void>;
  openLocalDirectory: () => Promise<void>;
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
  lyricsOpen: boolean;
  toggleLyrics: () => void;
  loadLyrics: (track: Track | null) => Promise<void>;
  sleepUntil: number | null;
  sleepRemaining: number;
  pauseAfterTrack: boolean;
  setSleepMinutes: (min: number) => void;
  setSleepAfterTrack: () => void;
  clearSleep: () => void;
  downloadTrack: (track: Track) => Promise<void>;
  accentEnabled: boolean;
  setAccentEnabled: (enabled: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const emptySnapshot: PlayerSnapshot = {
  state: "idle",
  current: null,
  position: 0,
  duration: 0,
  volume: 1,
  speed: 1,
  equalizer: [],
  shuffle: false,
  repeat: "off",
  queue: [],
  queueIndex: -1,
  history: [],
};

export const useApp = create<AppState>()((set, get) => ({
  services: null,
  ready: false,
  snapshot: emptySnapshot,
  likedIds: [],
  localTracks: [],
  notices: [],
  notify: (message) => {
    const id = Date.now() + Math.random();
    set((s) => ({ notices: [...s.notices, { id, message }].slice(-5) }));
    window.setTimeout(() => get().dismissNotice(id), 5000);
  },
  dismissNotice: (id) => {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },
  view: "home",
  setView: (v) => set({ view: v }),
  albumDetail: null,
  artistDetail: null,
  loadAlbum: async (providerId, albumId) => {
    const { services } = get();
    if (!services) return;
    const provider = services.providers.find((p) => p.id === providerId);
    if (!provider) return;
    try {
      const detail = await provider.getAlbum(albumId);
      set({ albumDetail: detail, view: "album" });
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },
  loadArtist: async (providerId, artistId) => {
    const { services } = get();
    if (!services) return;
    const provider = services.providers.find((p) => p.id === providerId);
    if (!provider) return;
    try {
      const detail = await provider.getArtist(artistId);
      set({ artistDetail: detail, view: "artist" });
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },
  clearDetail: () => set({ albumDetail: null, artistDetail: null }),

  playlists: [],
  selectedPlaylistId: null,
  setSelectedPlaylist: (id) => set({ selectedPlaylistId: id }),
  loadPlaylists: async () => {
    const { services } = get();
    if (!services) return;
    const pls = await services.storage.getPlaylists();
    set({ playlists: pls });
  },
  createPlaylist: async (name, tracks = []) => {
    const { services } = get();
    if (!services) return;
    const now = Date.now();
    const playlist: Playlist = {
      id: `playlist:${now}:${Math.random().toString(36).slice(2)}`,
      name,
      trackIds: tracks.map((t) => t.id),
      tracks,
      createdAt: now,
      updatedAt: now,
    };
    await services.storage.addPlaylist(playlist);
    await get().loadPlaylists();
  },
  deletePlaylist: async (id) => {
    const { services } = get();
    if (!services) return;
    await services.storage.removePlaylist(id);
    await get().loadPlaylists();
    set((s) => ({ selectedPlaylistId: s.selectedPlaylistId === id ? null : s.selectedPlaylistId }));
  },
  addToPlaylist: async (playlistId, track) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    if (!pl.trackIds.includes(track.id)) {
      pl.trackIds.push(track.id);
      pl.tracks = [...(pl.tracks ?? []), track];
      pl.updatedAt = Date.now();
      await services.storage.updatePlaylist(pl);
      await get().loadPlaylists();
    }
  },
  removeFromPlaylist: async (playlistId, trackId) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
    pl.tracks = pl.tracks?.filter((t) => t.id !== trackId);
    pl.updatedAt = Date.now();
    await services.storage.updatePlaylist(pl);
    await get().loadPlaylists();
  },

  init: () => {
    if (!initPromise) {
      initPromise = doInit(set, get);
    }
    return initPromise;
  },

  refreshLibrary: async () => {
    const { services } = get();
    if (!services) return;
    const liked = await services.library.getLikedTracks();
    set({ likedIds: liked.map((t) => t.id) });
  },

  play: async (tracks, index = 0) => {
    const { services } = get();
    if (!services) return;
    await services.engine.playTracks(tracks, index);
  },

  togglePlay: async () => {
    const { services } = get();
    if (!services) return;
    await services.engine.togglePlay();
  },

  next: async () => {
    const { services } = get();
    if (!services) return;
    await services.engine.next();
  },

  previous: async () => {
    const { services } = get();
    if (!services) return;
    await services.engine.previous();
  },

  seek: (seconds) => {
    get().services?.engine.seek(seconds);
  },

  setVolume: (percent) => {
    get().services?.engine.setVolume(percent / 100);
  },

  setSpeed: (rate) => {
    get().services?.engine.setPlaybackRate(rate);
  },

  setEqualizer: (gains) => {
    get().services?.engine.setEqualizer(gains);
  },

  toggleShuffle: () => {
    const { services, snapshot } = get();
    services?.engine.setShuffle(!snapshot.shuffle);
  },

  cycleRepeat: () => {
    const { services, snapshot } = get();
    const order: RepeatMode[] = ["off", "all", "one"];
    const next = order[(order.indexOf(snapshot.repeat) + 1) % order.length];
    services?.engine.setRepeat(next);
  },

  addToQueue: (track) => {
    get().services?.engine.addToQueue(track);
  },

  clearQueue: () => {
    get().services?.engine.clearQueue();
  },

  moveQueueItem: (fromIndex, toIndex) => {
    get().services?.engine.moveInQueue(fromIndex, toIndex);
  },

  toggleLike: async (track) => {
    const { services, snapshot } = get();
    const target = track ?? snapshot.current;
    if (!services || !target) return;
    await services.library.toggleLike(target);
    await get().refreshLibrary();
  },

  openLocalDirectory: async () => {
    const { services } = get();
    if (!services) return;
    try {
      const tracks = await services.local.openDirectory();
      if (tracks.length === 0) return;
      set({ localTracks: tracks });
      await services.engine.playTracks(tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  startWave: async () => {
    const { services } = get();
    if (!services) return;
    try {
      const tracks = await services.wave.generateWave(20);
      if (tracks.length === 0) throw new Error("wave is empty");
      await services.engine.playTracks(tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  downloadTrack: async (track) => {
    try {
      const ext = track.meta?.audioUrl?.toString().includes(".m4a") ? "m4a" : "mp3";
      const safe = (s: string) =>
        s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "track";
      const filename = `${safe(track.artist ?? "")} - ${safe(track.title ?? "")}.${ext}`;
      let defaultPath = filename;
      try {
        const dir = await open({ directory: true, multiple: false });
        if (dir && typeof dir === "string") defaultPath = `${dir}/${filename}`;
      } catch {
        // dialog unavailable, use default path
      }
      get().notify(`${t("player").downloading} ${track.title}`);
      const url = track.meta?.url ?? track.meta?.audioUrl?.toString() ?? "";
      if (!url) throw new Error("no source url");
      await invoke("yt_download", { url, outputPath: defaultPath });
      get().notify(`${t("player").download} ✓ ${track.title}`);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  lyrics: null,
  lyricsLoading: false,
  lyricsOpen: false,
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen })),
  loadLyrics: async (track) => {
    const { services } = get();
    if (!services) return;
    if (!track) {
      set({ lyrics: null, lyricsLoading: false });
      return;
    }
    set({ lyricsLoading: true });
    try {
      const result = await services.lyrics.getLyrics(track);
      set({ lyrics: result, lyricsLoading: false });
    } catch (e) {
      console.warn("[lyrics]", e);
      set({ lyricsLoading: false });
    }
  },

  sleepUntil: null,
  sleepRemaining: 0,
  pauseAfterTrack: false,
  setSleepMinutes: (min) => {
    if (min <= 0) {
      set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: false });
      return;
    }
    set({
      sleepUntil: Date.now() + min * 60_000,
      sleepRemaining: min * 60,
      pauseAfterTrack: false,
    });
  },
  setSleepAfterTrack: () => set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: true }),
  clearSleep: () => set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: false }),

  accentEnabled: isAccentEnabledPersist(),
  setAccentEnabled: (enabled) => {
    persistAccentEnabled(enabled);
    set({ accentEnabled: enabled });
    if (enabled) applyAccent(loadSavedAccent());
    else applyAccent(null);
  },
  theme: loadTheme(),
  setTheme: (theme) => {
    saveTheme(theme);
    applyTheme(theme);
    set({ theme });
  },
}));

async function doInit(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const services = await composeServices();
  await services.storage.init();
  const bind = (): void => set({ snapshot: services.engine.snapshot });
  services.engine.on("state", bind);
  services.engine.on("track", bind);
  services.engine.on("time", bind);
  services.engine.on("queue", bind);
  services.engine.on("volume", bind);
  services.engine.on("speed", bind);
  services.engine.on("equalizer", bind);
  services.engine.on("shuffle", bind);
  services.engine.on("repeat", bind);
  services.engine.on("error", (message) => get().notify(message));

  if (get().accentEnabled) {
    applyAccent(loadSavedAccent());
  }
  applyTheme(get().theme);

  const restore = loadRestore();
  if (restore) {
    await services.engine.restoreQueue(restore.queue, restore.index, restore.position);
  }

  const savedEq = loadSavedEqualizer();
  if (savedEq.length > 0) {
    services.engine.setEqualizer(savedEq);
  }
  services.engine.on("equalizer", () => {
    saveEqualizer(services.engine.snapshot.equalizer);
  });

  const savedSpeed = loadSavedSpeed();
  if (savedSpeed !== null && savedSpeed !== 1) {
    services.engine.setPlaybackRate(savedSpeed);
  }
  services.engine.on("speed", () => {
    saveSpeed(services.engine.snapshot.speed);
  });

  bindMediaSession(services, {
    togglePlay: () => void services.engine.togglePlay(),
    next: () => void services.engine.next(),
    previous: () => void services.engine.previous(),
    seek: (s) => services.engine.seek(s),
  });

  let queueSaveTimer: number | undefined;
  const scheduleQueueSave = (): void => {
    window.clearTimeout(queueSaveTimer);
    queueSaveTimer = window.setTimeout(() => {
      const snap = services.engine.snapshot;
      if (snap.queue.length > 0) saveRestore(snap.queue, snap.queueIndex, snap.position);
      else clearRestore();
    }, 600);
  };
  services.engine.on("queue", scheduleQueueSave);
  let lastPosSave = 0;
  services.engine.on("time", () => {
    const now = Date.now();
    if (now - lastPosSave < 5_000) return;
    lastPosSave = now;
    scheduleQueueSave();
  });

  window.setInterval(() => {
    const s = get();
    if (!s.sleepUntil) return;
    const remaining = Math.ceil((s.sleepUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      services.engine.pause();
      s.clearSleep();
      s.notify("Таймер сна: пауза");
    } else if (remaining !== s.sleepRemaining) {
      set({ sleepRemaining: remaining });
    }
  }, 1000);

  services.engine.on("track", (track) => {
    const s = get();
    if (s.pauseAfterTrack && track) {
      services.engine.pause();
      s.clearSleep();
      s.notify("Таймер сна: конец трека");
    }
    if (track) {
      void sendNowPlayingNotification(track);
    }
  });

  let lyricsTimer: number | undefined;
  let accentTimer: number | undefined;
  services.engine.on("track", (track) => {
    window.clearTimeout(lyricsTimer);
    if (!track) {
      set({ lyrics: null });
      return;
    }
    lyricsTimer = window.setTimeout(() => void get().loadLyrics(track), 600);
    window.clearTimeout(accentTimer);
    accentTimer = window.setTimeout(() => {
      if (!get().accentEnabled || !track.coverUrl) return;
      void accentFromImage(getCachedCover(track.coverUrl) ?? track.coverUrl).then((colors) => {
        if (colors) {
          applyAccent(colors);
          saveAccent(colors);
        }
      });
    }, 1500);
  });
  set({ services });
  const bridge = new ApiBridge(services);
  await bridge.start();
  await get().refreshLibrary();
  await get().loadPlaylists();
  bind();
  set({ ready: true });
  checkYtDlpUpdate();
}

function checkYtDlpUpdate() {
  const key = "wave-ytdlp-last-check";
  const last = localStorage.getItem(key);
  const now = Date.now();
  if (last && now - Number(last) < 24 * 60 * 60 * 1000) return;
  localStorage.setItem(key, String(now));
  void invoke("yt_update").catch(() => {});
}
