import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import type { AlbumDetail, ArtistDetail, Playlist, PlayerSnapshot, RepeatMode, Track } from "../core/types";
import type { LyricsResult } from "../core/lyrics/LyricsService";
import type { SmartPlaylistType } from "../core/library/SmartPlaylistGenerator";
import { generateSmartPlaylists } from "../core/library/SmartPlaylistGenerator";
import { composeServices, radioTracks, reconfigureServices, type AppServices } from "./compose";
import { ApiBridge } from "./bridge";
import { bindMediaSession } from "./mediaSession";
import { bindMpris } from "./mpris";
import { bindTray } from "./tray";
import { bindMiniBroadcast, bindMiniRemote } from "./mini";
import { bindGlobalHotkeys } from "./hotkeys";
import { clearRestore, loadRestore, saveRestore } from "./queueRestore";
import { type SyncedPlaylist, type PlaylistShare, sharePlaylist as apiShare, removeShareByEmail, getPlaylistShares, fetchSharedPlaylists } from "./supabase";
import { loadSavedEqualizer, saveEqualizer } from "./equalizerStore";
import { loadSavedSpeed, saveSpeed } from "./speedStore";
import { loadCrossfadeMs, saveCrossfadeMs } from "./crossfade";
import { loadDiscoveryRate, saveDiscoveryRate, DISCOVERY_MIN, DISCOVERY_MAX } from "./discoveryRate";
import { loadHistoryDecayDays, saveHistoryDecayDays, HISTORY_DECAY_MIN, HISTORY_DECAY_MAX } from "./historyDecay";
import { loadAutoGenerateThreshold, saveAutoGenerateThreshold, AUTO_GEN_MIN, AUTO_GEN_MAX } from "./autoGenerateThreshold";
import { loadAudioEffects, saveAudioEffects } from "./audioEffects";
import { loadTheme, saveTheme, applyTheme, onSystemThemeChange, type Theme } from "./themeStore";
import { streamPrewarmer } from "../core/player/streamPrewarm";
import { getCachedCover } from "../core/cover/CoverCache";
import { clearCoverCache } from "../core/cover/CoverCache";
import { clearSearchCache } from "./searchCache";
import { clearVariantsCache } from "./trackVariants";
import { findTrackVariants, type TrackVariant } from "./trackVariants";
import { registerDownload, unregisterDownload, offlineEnabled, setOfflineEnabled } from "./offline";
import {
  getBlockedTrackIds,
  getBlockedArtists,
  isArtistBlocked,
  isExcludePreviewsEnabled,
  isTrackBlocked,
  setExcludePreviewsEnabled,
  toggleBlockedArtist,
  toggleBlockedTrack,
} from "./platformSettings";
import { providerLabel } from "../ui/providers";
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

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export interface DownloadItem {
  id: string;
  track: Track;
  status: "queued" | "running" | "done" | "error";
  error?: string;
  percent?: number;
  dir: string;
  filePath?: string;
}

interface AppState {
  services: AppServices | null;
  ready: boolean;
  snapshot: PlayerSnapshot;
  

  position: number;
  duration: number;
  likedIds: Set<string>;
  localTracks: Track[];
  notices: { id: number; message: string }[];
  notify: (message: string) => void;
  dismissNotice: (id: number) => void;
  logs: { time: number; message: string }[];
  pushLog: (message: string) => void;
  clearLogs: () => void;
  reloadServices: () => Promise<void>;
  view: "home" | "nowPlaying" | "search" | "library" | "queue" | "wave" | "album" | "artist" | "playlist" | "settings" | "downloads";
  setView: (v: AppState["view"]) => void;
  
  navStack: AppState["view"][];
  goBack: () => void;
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
  reorderPlaylist: (playlistId: string, from: number, to: number) => void;
  sharedPlaylists: SyncedPlaylist[];
  playlistShares: PlaylistShare[];
  sharePlaylist: (playlistId: string, email: string, permission?: "editor" | "viewer") => Promise<boolean>;
  unsharePlaylist: (playlistId: string, email: string) => Promise<void>;
  loadShares: (playlistId: string) => Promise<void>;
  loadSharedPlaylists: () => Promise<void>;
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
  playNext: (track: Track) => void;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  toggleLike: (track?: Track) => Promise<void>;
  updateLocalTrack: (trackId: string, meta: Partial<Pick<Track, "title" | "artist" | "album" | "genre" | "year">>) => void;
  startWave: () => Promise<void>;
  previewWave: () => Promise<void>;
  previewTracks: Track[];
  previewLoading: boolean;
  startSmartPlaylist: (type: SmartPlaylistType) => Promise<void>;
  openLocalDirectory: () => Promise<void>;
  variants: TrackVariant[];
  variantsLoading: boolean;
  loadVariants: (track: Track | null) => Promise<void>;
  playVariant: (variant: TrackVariant) => void;
  addSimilar: () => Promise<void>;
  toggleBlockTrack: (track: Track) => void;
  toggleBlockArtist: (artist: string) => void;
  blockedTrackIds: string[];
  blockedArtists: string[];
  unblockTrack: (id: string) => void;
  unblockArtist: (name: string) => void;
  clearCaches: () => void;
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
  lyricsOpen: boolean;
  toggleLyrics: () => void;
  loadLyrics: (track: Track | null) => Promise<void>;
  reloadLyrics: () => Promise<void>;
  sleepUntil: number | null;
  sleepRemaining: number;
  pauseAfterTrack: boolean;
  setSleepMinutes: (min: number) => void;
  setSleepAfterTrack: () => void;
  clearSleep: () => void;
  downloadTrack: (track: Track) => Promise<void>;
  downloads: DownloadItem[];
  downloading: boolean;
  clearDownloads: () => void;
  retryDownload: (id: string) => void;
  pumpDownloads: () => Promise<void>;
  radioActive: boolean;
  startRadio: (track?: Track) => Promise<void>;
  autoContinue: boolean;
  setAutoContinue: (enabled: boolean) => void;
  offlineMode: boolean;
  setOfflineMode: (enabled: boolean) => void;
  excludePreviews: boolean;
  setExcludePreviews: (enabled: boolean) => void;
  accentEnabled: boolean;
  setAccentEnabled: (enabled: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  compactPlayer: boolean;
  setCompactPlayer: (compact: boolean) => void;
  lyricsAutoOpen: boolean;
  setLyricsAutoOpen: (enabled: boolean) => void;
  lyricsAutoscroll: boolean;
  setLyricsAutoscroll: (enabled: boolean) => void;
   crossfadeMs: number;
   setCrossfadeMs: (ms: number) => void;
   discoveryRate: number;
   setDiscoveryRate: (rate: number) => void;
   historyDecayDays: number;
   setHistoryDecayDays: (days: number) => void;
   autoGenerateThreshold: number;
   setAutoGenerateThreshold: (threshold: number) => void;
   bassBoost: number;
  setBassBoost: (db: number) => void;
  reverb: number;
  setReverb: (mix: number) => void;
  stereoWidth: number;
  setStereoWidth: (pan: number) => void;
}

const emptySnapshot: PlayerSnapshot = {
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
};

const TAB_VIEWS: ReadonlySet<AppState["view"]> = new Set([
  "home",
  "search",
  "wave",
  "library",
  "settings",
]);
const isTabView = (v: AppState["view"]): boolean => TAB_VIEWS.has(v);

export const useApp = create<AppState>()((set, get) => ({
  services: null,
  ready: false,
  snapshot: emptySnapshot,
  position: 0,
  duration: 0,
  likedIds: new Set<string>(),
  localTracks: [],
  notices: [],
  notify: (message) => {
    const id = Date.now() + Math.random();
    set((s) => ({ notices: [...s.notices, { id, message }].slice(-5) }));
    window.setTimeout(() => get().dismissNotice(id), 5000);
    get().pushLog(message);
  },
  dismissNotice: (id) => {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },
  logs: [],
  pushLog: (message) => {
    set((s) => ({ logs: [...s.logs, { time: Date.now(), message }].slice(-50) }));
  },
  clearLogs: () => {
    set({ logs: [] });
  },
  view: "home",
  navStack: ["home"],
  setView: (v) =>
    set((s) => {
      if (s.view === v) return s;
      const navStack = isTabView(v)
        ? [v]
        : s.navStack[s.navStack.length - 1] === v
          ? s.navStack
          : [...s.navStack, v];
      return { view: v, navStack };
    }),
  goBack: () =>
    set((s) => {
      if (s.navStack.length <= 1) return s;
      const navStack = s.navStack.slice(0, -1);
      const view = navStack[navStack.length - 1];
      return {
        view,
        navStack,
        ...(s.view === "album" ? { albumDetail: null } : {}),
        ...(s.view === "artist" ? { artistDetail: null } : {}),
      };
    }),
  albumDetail: null,
  artistDetail: null,
  loadAlbum: async (providerId, albumId) => {
    const { services } = get();
    if (!services) return;
    const provider = services.providers.find((p) => p.id === providerId);
    if (!provider) return;
    try {
      const detail = await provider.getAlbum(albumId);
      set({ albumDetail: detail });
      streamPrewarmer.prewarm(detail.tracks);
      get().setView("album");
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
      set({ artistDetail: detail });
      streamPrewarmer.prewarm(detail.topTracks);
      get().setView("artist");
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },
  clearDetail: () => set({ albumDetail: null, artistDetail: null }),

  playlists: [],
  selectedPlaylistId: null,
  setSelectedPlaylist: (id) => {
    set({ selectedPlaylistId: id });
    const playlist = get().playlists.find((p) => p.id === id);
    if (playlist?.tracks) streamPrewarmer.prewarm(playlist.tracks);
  },
  sharedPlaylists: [],
  playlistShares: [],
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
      coverUrl: tracks[0]?.coverUrl,
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
      if (!pl.coverUrl && track.coverUrl) pl.coverUrl = track.coverUrl;
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
  reorderPlaylist: (playlistId, from, to) => {
    const { services } = get();
    const pl = get().playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const tracks = pl.tracks ?? [];
    if (from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) {
      return;
    }
    const copy = [...tracks];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    const trackIds = copy.map((t) => t.id);
    set((s) => ({
      ...s,
      playlists: s.playlists.map((p) =>
        p.id === playlistId ? { ...p, tracks: copy, trackIds } : p,
      ),
    }));
    if (services) {
      void services.storage
        .updatePlaylist({ ...pl, tracks: copy, trackIds, updatedAt: Date.now() })
        .catch(() => {});
    }
  },

  sharePlaylist: async (playlistId, email, permission = "editor") => {
    const { getCurrentUser } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return false;
    const result = await apiShare(user.id, playlistId, email, permission);
    if (result) {
      await get().loadShares(playlistId);
      return true;
    }
    return false;
  },

  unsharePlaylist: async (playlistId, email) => {
    const { getCurrentUser } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    await removeShareByEmail(user.id, playlistId, email);
    await get().loadShares(playlistId);
  },

  loadShares: async (playlistId) => {
    const { getCurrentUser } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    const shares = await getPlaylistShares(user.id, playlistId);
    set({ playlistShares: shares });
  },

  loadSharedPlaylists: async () => {
    const { getCurrentUser } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    const shared = await fetchSharedPlaylists(user.id);
    set({ sharedPlaylists: shared });
  },

  init: () => {
    if (!initPromise) {
      initPromise = doInit(set, get);
    }
    return initPromise;
  },

  reloadServices: async () => {
    const { services } = get();
    if (!services) return;
    const rebuilt = await reconfigureServices(services);
    set({ services: rebuilt });
  },

  refreshLibrary: async () => {
    const { services } = get();
    if (!services) return;
    const liked = await services.library.getLikedTracks();
    set({ likedIds: new Set(liked.map((t) => t.id)) });
  },

  play: async (tracks, index = 0) => {
    const { services } = get();
    if (!services) return;
    if (get().radioActive) {
      services.engine.setAutoFill(get().autoContinue ? null : async () => []);
      set({ radioActive: false });
    }
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
    await services.engine.next(true);
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
    const next = !snapshot.shuffle;
    services?.engine.setShuffle(next);
    get().notify(next ? t("toasts").shuffleOn : t("toasts").shuffleOff);
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
  playNext: (track) => {
    get().services?.engine.playNext(track);
  },

  clearQueue: () => {
    get().services?.engine.clearQueue();
  },

  moveQueueItem: (fromIndex, toIndex) => {
    get().services?.engine.moveInQueue(fromIndex, toIndex);
  },

  removeFromQueue: (index) => {
    get().services?.engine.removeFromQueue(index);
  },

  toggleLike: async (track) => {
    const { services, snapshot } = get();
    const target = track ?? snapshot.current;
    if (!services || !target) return;
    await services.library.toggleLike(target);
    await get().refreshLibrary();
  },

  updateLocalTrack: (trackId, meta) => {
    set((s) => ({
      ...s,
      localTracks: s.localTracks.map((tr) => (tr.id === trackId ? { ...tr, ...meta } : tr)),
    }));
    
    
    get().services?.engine.updateTrack(trackId, meta);
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
  previewTracks: [],
  previewLoading: false,
  previewWave: async () => {
    const { services } = get();
    if (!services) return;
    set({ previewLoading: true });
    try {
      const tracks = await services.wave.generateWave(20);
      set({ previewTracks: tracks, previewLoading: false });
    } catch (e) {
      set({ previewLoading: false });
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  startSmartPlaylist: async (type) => {
    const { services } = get();
    if (!services) return;
    try {
      const history = await services.history.getHistory(2000);
      const likedTracks = await services.library.getLikedTracks();
      const playlists = generateSmartPlaylists(history, likedTracks);
      const target = playlists.find((p) => p.type === type);
      if (!target || target.tracks.length === 0) throw new Error("empty");
      await services.engine.playTracks(target.tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  downloadTrack: async (track) => {
    let dir = "";
    try {
      dir = localStorage.getItem("wave-download-dir") ?? "";
    } catch {
      dir = "";
    }
    if (!dir) {
      try {
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked === "string") {
          dir = picked;
          try {
            localStorage.setItem("wave-download-dir", dir);
          } catch {
            
          }
        }
      } catch {
        
      }
    }
    if (!dir) {
      
      try {
        dir = await invoke<string>("app_download_dir");
      } catch {
        
      }
    }
    if (!dir) {
      get().notify(t("player").downloadDirRequired);
      return;
    }
    const exists = get().downloads.some(
      (d) =>
        d.track.id === track.id &&
        d.dir === dir &&
        (d.status === "queued" || d.status === "running" || d.status === "done"),
    );
    if (exists) {
      get().notify(t("downloads").dlAlreadyQueued);
      return;
    }
    const id = `dl:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    set((s) => ({ downloads: [...s.downloads, { id, track, status: "queued", dir }] }));
    void get().pumpDownloads();
  },

  downloads: [],
  downloading: false,
  clearDownloads: () =>
    set((s) => {
      for (const d of s.downloads) {
        if (d.status === "done" && d.filePath) unregisterDownload(d.filePath);
      }
      return {
        downloads: s.downloads.filter((d) => d.status === "queued" || d.status === "running"),
      };
    }),

  retryDownload: (id) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id ? { ...d, status: "queued", error: undefined, percent: 0 } : d,
      ),
    }));
    void get().pumpDownloads();
  },

  pumpDownloads: async () => {
    const s = get();
    if (!s.services || s.downloading) return;
    const next = s.downloads.find((d) => d.status === "queued");
    if (!next) return;
    set((prev) => ({
      downloading: true,
      downloads: prev.downloads.map((d) =>
        d.id === next.id ? { ...d, status: "running", percent: 0 } : d,
      ),
    }));
    const finish = (patch: Partial<DownloadItem>): void => {
      set((prev) => ({
        downloading: false,
        downloads: prev.downloads.map((d) =>
          d.id === next.id ? { ...d, ...patch } : d,
        ),
      }));
    };
    try {
      const url =
        String(next.track.meta?.url ?? "") ||
        String(next.track.meta?.audioUrl ?? "") ||
        (next.track.uri ?? "");
      if (!url) throw new Error("no source url");
      const ext = url.includes(".m4a") ? "m4a" : "mp3";
      const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "track";
      const filename = `${safe(next.track.artist ?? "")} - ${safe(next.track.title ?? "")}.${ext}`;
      const outputPath = `${next.dir}/${filename}`;
      await invoke("yt_download", {
        url,
        outputPath,
        jobId: next.id,
      });
      registerDownload(outputPath, next.track.artist, next.track.title);
      finish({ status: "done", percent: 100, filePath: outputPath });
    } catch (e) {
      finish({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    void get().pumpDownloads();
  },

  radioActive: false,
  autoContinue: (() => {    try {
      return localStorage.getItem("wave-autocontinue") !== "0";
    } catch {
      return true;
    }
  })(),
  setAutoContinue: (enabled) => {
    try {
      localStorage.setItem("wave-autocontinue", enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ autoContinue: enabled });
    const { services } = get();
    if (!services || get().radioActive) return;
    services.engine.setAutoFill(enabled ? null : async () => []);
  },
  offlineMode: (() => {
    try {
      return offlineEnabled();
    } catch {
      return false;
    }
  })(),
  setOfflineMode: (enabled) => {
    setOfflineEnabled(enabled);
    set({ offlineMode: enabled });
  },
  excludePreviews: (() => {
    try {
      return isExcludePreviewsEnabled();
    } catch {
      return true;
    }
  })(),
  setExcludePreviews: (enabled) => {
    setExcludePreviewsEnabled(enabled);
    set({ excludePreviews: enabled });
    // Результаты поиска кешируются — при переключении фильтра нужен свежий поиск.
    clearSearchCache();
  },
  startRadio: async (seedTrack) => {
    const { services, snapshot } = get();
    const track = seedTrack ?? snapshot.current;
    if (!services || !track) return;
    try {
      set({ radioActive: true });
      services.engine.setAutoFill(async () => {
        const last = services.engine.snapshot.current;
        if (!last) return [];
        return radioTracks(services, last);
      });
      const seed = await radioTracks(services, track);
      await services.engine.playTracks([track, ...seed]);
      get().notify(t("player").radio);
    } catch (e) {
      set({ radioActive: false });
      services.engine.setAutoFill(null);
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  variants: [],
  variantsLoading: false,
  loadVariants: async (track) => {
    const { services } = get();
    if (!track || !services) {
      set({ variants: [], variantsLoading: false });
      return;
    }
    set({ variants: [], variantsLoading: true });
    try {
      const found = await findTrackVariants(services.providers, track);
      if (get().snapshot.current?.id === track.id) {
        set({ variants: found, variantsLoading: false });
      } else {
        set({ variantsLoading: false });
      }
    } catch {
      set({ variants: [], variantsLoading: false });
    }
  },
  playVariant: (variant) => {
    const { services } = get();
    if (!services) return;
    services.engine.playVariant(variant.track);
  },

  addSimilar: async () => {
    const { services, snapshot } = get();
    const track = snapshot.current;
    if (!services || !track) return;
    try {
      const similar = await radioTracks(services, track);
      if (similar.length === 0) {
        get().notify(t("toasts").similarEmpty);
        return;
      }
      for (const tr of similar) services.engine.addToQueue(tr);
      get().notify(t("toasts").similarAdded(similar.length));
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  toggleBlockTrack: (track) => {
    const blocked = toggleBlockedTrack(track.id);
    get().notify(blocked ? t("toasts").trackBlocked : t("toasts").trackUnblocked);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },

  toggleBlockArtist: (artist) => {
    const blocked = toggleBlockedArtist(artist);
    get().notify(blocked ? t("toasts").artistBlocked : t("toasts").artistUnblocked);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },

  blockedTrackIds: [],
  blockedArtists: [],
  unblockTrack: (id) => {
    toggleBlockedTrack(id);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },
  unblockArtist: (name) => {
    toggleBlockedArtist(name);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },

  clearCaches: () => {
    clearSearchCache();
    clearVariantsCache();
    clearCoverCache();
    get().services?.lyrics.clearCache();
    get().notify(t("toasts").cachesCleared);
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
    const token = ++lyricsToken;
    set({ lyricsLoading: true });
    try {
      const result = await services.lyrics.getLyrics(track);
      if (token !== lyricsToken) return;
      set({ lyrics: result, lyricsLoading: false });
    } catch (e) {
      console.warn("[lyrics]", e);
      if (token !== lyricsToken) return;
      set({ lyricsLoading: false });
    }
  },
  reloadLyrics: async () => {
    const { services, snapshot } = get();
    const track = snapshot.current;
    if (!services || !track) return;
    services.lyrics.invalidate(track.id);
    await get().loadLyrics(track);
  },

  sleepUntil: null,
  sleepRemaining: 0,
  pauseAfterTrack: false,
  setSleepMinutes: (min) => {
    if (min <= 0) {
      get().services?.engine.setPauseAfterTrack(false);
      stopSleepTimer();
      set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: false });
      return;
    }
    get().services?.engine.setPauseAfterTrack(false);
    set({
      sleepUntil: Date.now() + min * 60_000,
      sleepRemaining: min * 60,
      pauseAfterTrack: false,
    });
    kickSleepTimer();
  },
  setSleepAfterTrack: () => {
    stopSleepTimer();
    get().services?.engine.setPauseAfterTrack(true);
    set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: true });
  },
  clearSleep: () => {
    stopSleepTimer();
    get().services?.engine.setPauseAfterTrack(false);
    set({ sleepUntil: null, sleepRemaining: 0, pauseAfterTrack: false });
  },

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
  compactPlayer: localStorage.getItem("wave-compact-player") === "1",
  setCompactPlayer: (compact) => {
    localStorage.setItem("wave-compact-player", compact ? "1" : "0");
    set({ compactPlayer: compact });
  },
  lyricsAutoOpen: localStorage.getItem("wave-lyrics-autoopen") === "1",
  setLyricsAutoOpen: (enabled) => {
    localStorage.setItem("wave-lyrics-autoopen", enabled ? "1" : "0");
    set({ lyricsAutoOpen: enabled });
  },
  lyricsAutoscroll: localStorage.getItem("wave-lyrics-autoscroll") !== "0",
  setLyricsAutoscroll: (enabled) => {
    localStorage.setItem("wave-lyrics-autoscroll", enabled ? "1" : "0");
    set({ lyricsAutoscroll: enabled });
  },
  crossfadeMs: loadCrossfadeMs(),
  setCrossfadeMs: (ms) => {
    saveCrossfadeMs(ms);
    set({ crossfadeMs: ms });
    get().services?.engine.setCrossfadeMs(ms);
  },
   discoveryRate: loadDiscoveryRate(),
   setDiscoveryRate: (rate) => {
     const clamped = Math.min(Math.max(rate, DISCOVERY_MIN), DISCOVERY_MAX);
     saveDiscoveryRate(clamped);
     set({ discoveryRate: clamped });
     get().services?.wave.setDiscoveryRate(clamped);
   },
   historyDecayDays: loadHistoryDecayDays(),
   setHistoryDecayDays: (days) => {
     const clamped = Math.min(Math.max(days, HISTORY_DECAY_MIN), HISTORY_DECAY_MAX);
     saveHistoryDecayDays(clamped);
     set({ historyDecayDays: clamped });
     get().services?.wave.setHistoryDecayDays(clamped);
   },
  autoGenerateThreshold: loadAutoGenerateThreshold(),
  setAutoGenerateThreshold: (threshold) => {
    const clamped = Math.min(Math.max(threshold, AUTO_GEN_MIN), AUTO_GEN_MAX);
    saveAutoGenerateThreshold(clamped);
    set({ autoGenerateThreshold: clamped });
    get().services?.engine.setAutoGenerateThreshold(clamped);
  },
  ...(() => {
    const fx = loadAudioEffects();
    return {
      bassBoost: fx.bassBoost,
      reverb: fx.reverb,
      stereoWidth: fx.stereoWidth,
    };
  })(),
  setBassBoost: (db) => {
    const clamped = Math.min(Math.max(db, 0), 15);
    set({ bassBoost: clamped });
    get().services?.engine.setBassBoost(clamped);
    saveAudioEffects({ bassBoost: clamped, reverb: get().reverb, stereoWidth: get().stereoWidth });
  },
  setReverb: (mix) => {
    const clamped = Math.min(Math.max(mix, 0), 1);
    set({ reverb: clamped });
    get().services?.engine.setReverb(clamped);
    saveAudioEffects({ bassBoost: get().bassBoost, reverb: clamped, stereoWidth: get().stereoWidth });
  },
  setStereoWidth: (pan) => {
    const clamped = Math.min(Math.max(pan, -1), 1);
    set({ stereoWidth: clamped });
    get().services?.engine.setStereoWidth(clamped);
    saveAudioEffects({ bassBoost: get().bassBoost, reverb: get().reverb, stereoWidth: clamped });
  },
}));

let sleepKickTimer: number | undefined;
let lyricsToken = 0;

/** Один самоперепланируемый таймер обратного отсчёта сна (вместо вечного setInterval). */
function kickSleepTimer(): void {
  window.clearTimeout(sleepKickTimer);
  sleepKickTimer = window.setTimeout(function tick() {
    const s = useApp.getState();
    if (!s.sleepUntil) {
      sleepKickTimer = undefined;
      return;
    }
    const remaining = Math.ceil((s.sleepUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      s.clearSleep();
      s.notify(t("player").sleepTimerExpired);
      return;
    }
    if (remaining !== s.sleepRemaining) useApp.setState({ sleepRemaining: remaining });
    sleepKickTimer = window.setTimeout(tick, 1000);
  }, 1000);
}

function stopSleepTimer(): void {
  window.clearTimeout(sleepKickTimer);
  sleepKickTimer = undefined;
}

async function doInit(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const services = await composeServices();
  await services.storage.init();
  const bind = (): void => set({ snapshot: services.engine.snapshot });
  services.engine.on("state", bind);
  if (IS_ANDROID) {
    const syncAndroid = (playing: boolean) => {
      const snap = services.engine.snapshot;
      const track = snap.current;
      void invoke("set_playback", {
        playing,
        title: track?.title ?? null,
        artist: track?.artist ?? null,
        duration: snap.duration,
        position: snap.position,
        coverUrl: track?.coverUrl ?? null,
      }).catch(() => {});
    };
    services.engine.on("state", (s) => {
      syncAndroid(s === "playing");
    });
    services.engine.on("track", () => {
      syncAndroid(services.engine.snapshot.state === "playing");
    });
    let lastAndroidSync = 0;
    services.engine.on("time", ({ position }) => {
      const now = Date.now();
      if (now - lastAndroidSync < 5000) return;
      if (!services.engine.snapshot.current) return;
      lastAndroidSync = now;
      void invoke("set_playback", {
        playing: services.engine.snapshot.state === "playing",
        title: services.engine.snapshot.current?.title ?? null,
        artist: services.engine.snapshot.current?.artist ?? null,
        duration: services.engine.snapshot.duration,
        position,
        coverUrl: services.engine.snapshot.current?.coverUrl ?? null,
      }).catch(() => {});
    });
    (globalThis as unknown as Record<string, unknown>).__wave_media_action = (action: string) => {
      const engine = services.engine;
      switch (action) {
        case "prev": void engine.previous(); break;
        case "next": void engine.next(true); break;
        case "play": void engine.play(); break;
        case "pause": engine.pause(); break;
      }
    };
    const pollMediaAction = () => {
      void invoke<string | null>("consume_media_action").then((action) => {
        if (action) {
          const handler = (globalThis as unknown as Record<string, unknown>).__wave_media_action as ((a: string) => void) | undefined;
          handler?.(action);
        }
      }).catch(() => {});
    };
    setInterval(pollMediaAction, 2000);
  }
  services.engine.on("track", bind);
  // Прогресс — отдельно: часто (несколько раз/с), но трогает только подписчиков position.
  services.engine.on("time", ({ position, duration }) => set({ position, duration }));
  services.engine.on("queue", bind);
  services.engine.on("volume", bind);
  services.engine.on("speed", bind);
  services.engine.on("equalizer", bind);
  services.engine.on("shuffle", bind);
  services.engine.on("repeat", bind);
  services.engine.on("error", (message) => get().notify(message));

  // Прогресс загрузок из Rust (yt-dlp).
  void listen<{ jobId: string; percent: number }>("download-progress", (event) => {
    const { jobId, percent } = event.payload;
    const s = get();
    set({
      downloads: s.downloads.map((d) =>
        d.id === jobId && d.status === "running" ? { ...d, percent } : d,
      ),
    });
  });

  // Авто-фолбэк на вариант (другой источник), если текущий не воспроизводится.
  services.engine.setFallback(() => {
    const s = get();
    const cur = s.snapshot.current;
    if (!cur) return null;
    const list = s.variants;
    if (list.length === 0) return null;
    const candidate =
      list.find((v) => v.providerId !== cur.provider && v.track.uri && !v.track.meta?.noPlay) ??
      list.find((v) => v.providerId !== cur.provider) ??
      list[0];
    if (!candidate) return null;
    s.notify(t("toasts").fallbackSwitched(providerLabel(candidate.providerId)));
    return candidate.track;
  });

  // «Моя волна» не включает заблокированные треки/артистов.
  services.wave.setBlockFilter(
    (track) => !isTrackBlocked(track.id) && !isArtistBlocked(track.artist),
  );

  // Инициализация заблокированных списков
  set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });

  // Skip reaction: откат контекста при быстром скипе
  services.engine.on("skipped", ({ percent }) => {
    const track = services.engine.snapshot.current;
    if (track) services.wave.onTrackSkipped(track, percent);
  });

  // Track ended: обогащение контекста при долгом прослушивании
  services.engine.on("ended", () => {
    const track = services.engine.snapshot.current;
    if (track) services.wave.onTrackCompleted(track, 1.0);
  });

  // Автопродолжение очереди (волна/похожие), если настройка выключена — стоп.
  if (!get().autoContinue) {
    services.engine.setAutoFill(async () => []);
  }

  if (get().accentEnabled) {
    applyAccent(loadSavedAccent());
  }
  applyTheme(get().theme);
  onSystemThemeChange(() => {
    if (get().theme === "system") applyTheme("system");
  });
  { const { loadAccentColor, applyAccentColor } = await import("./accentStore");
    applyAccentColor(loadAccentColor()); }

  const restore = loadRestore();
  if (restore) {
    await services.engine.restoreQueue(restore.queue, restore.index, restore.position);
    void get().loadVariants(services.engine.snapshot.current);
  }

  const savedEq = loadSavedEqualizer();
  if (savedEq.length > 0) {
    services.engine.setEqualizer(savedEq);
  }
  services.engine.on("equalizer", () => {
    saveEqualizer(services.engine.snapshot.equalizer);
  });

  const savedFx = loadAudioEffects();
  if (savedFx.bassBoost > 0) services.engine.setBassBoost(savedFx.bassBoost);
  if (savedFx.reverb > 0) services.engine.setReverb(savedFx.reverb);
  if (savedFx.stereoWidth !== 0) services.engine.setStereoWidth(savedFx.stereoWidth);

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

  if ((window as { __TAURI__?: unknown }).__TAURI__) {
    bindMpris(services);
    bindTray(services);
    bindMiniBroadcast(services);
    bindMiniRemote(services);
    bindGlobalHotkeys(services);
  }

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

  kickSleepTimer();

  services.engine.on("track", (track) => {
    void get().loadVariants(track);
    // Волна не должна предлагать только что сыгранное.
    if (track) services.wave.markPlayed(track);
  });

  // Таймер сна «после трека»: движок уже остановлен по завершении трека
  // (setPauseAfterTrack), здесь только очищаем состояние и уведомляем.
  services.engine.on("ended", () => {
    const s = get();
    if (!s.pauseAfterTrack) return;
    s.clearSleep();
    s.notify(t("player").sleepTimerAfterTrack);
  });

  let lyricsTimer: number | undefined;
  let accentTimer: number | undefined;
  services.engine.on("track", (track) => {
    window.clearTimeout(lyricsTimer);
    if (!track) {
      set({ lyrics: null, lyricsLoading: false });
      return;
    }
    if (get().lyricsAutoOpen) set({ lyricsOpen: true });
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
  void checkForUpdates();
}

function checkYtDlpUpdate() {
  const key = "wave-ytdlp-last-check";
  const last = localStorage.getItem(key);
  const now = Date.now();
  if (last && now - Number(last) < 24 * 60 * 60 * 1000) return;
  localStorage.setItem(key, String(now));
  void invoke("yt_update").catch(() => {});
}

async function checkForUpdates(): Promise<void> {
  if ((window as { __TAURI__?: unknown }).__TAURI__ === undefined) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;
    if (!window.confirm(t("toasts").updateAvailable(update.version))) return;
    await update.downloadAndInstall();
    await invoke("relaunch");
  } catch {
    // updater не настроен (нет подписанных релизов) — молча пропускаем.
  }
}
