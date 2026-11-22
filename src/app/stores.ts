import { create } from "zustand";
import type { AgentExecutor } from "../core/agent/AgentExecutor";
import { createNavigationSlice, type NavigationSlice } from "./navigationSlice";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createArtistRadioSlice, type ArtistRadioSlice } from "./artistRadioSlice";
import { listen } from "@tauri-apps/api/event";

import type { PlaybackMode, Playlist, PlayerSnapshot, RepeatMode, Track } from "../core/types";
import type { LyricsResult } from "../core/lyrics/LyricsService";
import { uniqueRecommendations } from "../core/recordings/matching";
import type { SmartPlaylistType } from "../core/library/SmartPlaylistGenerator";
import { generateSmartPlaylists } from "../core/library/SmartPlaylistGenerator";
import { composeServices, radioTracks, reconfigureServices, type AppServices } from "./compose";
import { ApiBridge } from "./bridge";
import { bindMediaSession } from "./mediaSession";
import { bindMpris } from "./mpris";
import { bindTray } from "./tray";
import { bindMiniBroadcast, bindMiniRemote } from "./mini";
import { bindGlobalHotkeys } from "./hotkeys";
import { bindDiscord } from "./discord";
import { bindPlugins } from "./plugins";
import { clearRestore, loadRestore, saveRestore } from "./queueRestore";
import { type SyncedPlaylist, type PlaylistShare } from "./supabase";
import { loadSavedEqualizer, saveEqualizer } from "./equalizerStore";
import { sanitizeAudioValue } from "../core/player/equalizerPresets";
import { loadSavedSpeed, saveSpeed } from "./speedStore";
import { loadLeveling, saveLeveling } from "./levelingStore";
import type { NormalizationMode } from "../core/player/leveling";
import { loadAlarm, saveAlarm, nextAlarmTimestamp, type AlarmDef } from "./alarm";
import { watchConnectivity, currentConnectivity } from "./connectivity";
import { loadCrossfadeMs, saveCrossfadeMs } from "./crossfade";
import { loadDiscoveryRate, saveDiscoveryRate, DISCOVERY_MIN, DISCOVERY_MAX } from "./discoveryRate";
import { loadHistoryDecayDays, saveHistoryDecayDays, HISTORY_DECAY_MIN, HISTORY_DECAY_MAX } from "./historyDecay";
import { loadAutoGenerateThreshold, saveAutoGenerateThreshold, AUTO_GEN_MIN, AUTO_GEN_MAX } from "./autoGenerateThreshold";
import { loadAudioEffects, saveAudioEffects } from "./audioEffects";
import { loadPreferredLanguages, savePreferredLanguages } from "./preferredLanguages";
import { isOnboardingCompleted, completeOnboarding as persistOnboarding } from "./onboarding";
import { loadTheme, saveTheme, applyTheme, onSystemThemeChange, type Theme } from "./themeStore";
import { getCachedCover } from "../core/cover/CoverCache";
import { clearCoverCache } from "../core/cover/CoverCache";
import { clearSearchCache } from "./searchCache";
import { clearVariantsCache } from "./trackVariants";
import { createVariantsSlice, type VariantsSlice } from "./variantsSlice";
import { playbackSource } from "../core/types";
import { offlineEnabled, setOfflineEnabled } from "./offline";
import { createDownloadsSlice, type DownloadsSlice } from "./downloadsSlice";
import {
  getBlockedTrackIds,
  getBlockedArtists,
  isArtistBlocked,
  isExcludePreviewsEnabled,
  isTrackBlocked,
  setExcludePreviewsEnabled,
  toggleBlockedArtist,
  toggleBlockedTrack,
  clearBlockedTracks,
  clearBlockedArtists,
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
let agentGeneration = 0;
let agentRetirement: Promise<void> = Promise.resolve();

const savedLeveling = loadLeveling();

let alarmRampTimer: number | undefined;
function cancelAlarmRamp(): void {
  if (alarmRampTimer !== undefined) {
    clearInterval(alarmRampTimer);
    alarmRampTimer = undefined;
  }
}

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export type { DownloadItem } from "./downloadsSlice";

export interface AppState extends VariantsSlice, DownloadsSlice, ArtistRadioSlice, NavigationSlice {
  agentSession: AgentExecutor | null;
  openAgentSession: () => Promise<AgentExecutor>;
  closeAgentSession: () => void;
  services: AppServices | null;
  ready: boolean;
  onboardingCompleted: boolean;
  snapshot: PlayerSnapshot;
  

  position: number;
  duration: number;
  likedIds: Set<string>;
  localTracks: Track[];
  notices: { id: number; message: string; actionLabel?: string; onAction?: () => void }[];
  notify: (message: string, action?: { label: string; run: () => void }) => void;
  dismissNotice: (id: number) => void;
  logs: { time: number; message: string }[];
  pushLog: (message: string) => void;
  clearLogs: () => void;
  reloadServices: () => Promise<void>;
  playlists: Playlist[];
  selectedPlaylistId: string | null;
  setSelectedPlaylist: (id: string | null) => void;
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string, tracks?: Track[], signal?: AbortSignal) => Promise<Playlist | null>;
  importPlaylistFromLink: (url: string, signal?: AbortSignal) => Promise<number>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (playlistId: string, track: Track, signal?: AbortSignal) => Promise<boolean | null>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, from: number, to: number) => void;
  setPlaylistFolder: (playlistId: string, folder: string | null) => Promise<void>;
  setPlaylistCover: (playlistId: string, coverUrl?: string) => Promise<void>;
  sharedPlaylists: SyncedPlaylist[];
  playlistShares: PlaylistShare[];
  sharePlaylist: (playlistId: string, email: string, permission?: "editor" | "viewer") => Promise<boolean>;
  unsharePlaylist: (playlistId: string, email: string) => Promise<void>;
  loadShares: (playlistId: string) => Promise<void>;
  loadSharedPlaylists: () => Promise<void>;
  completeOnboarding: (artistNames: string[]) => void;
  init: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  play: (tracks: Track[], index?: number, mode?: PlaybackMode, position?: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (percent: number) => void;
  setSpeed: (rate: number) => void;
  setEqualizer: (gains: number[]) => void;
  effectsBypassed: boolean;
  setEffectsBypassed: (bypassed: boolean) => void;
  levelingEnabled: boolean;
  levelingTargetDb: number;
  levelingMode: NormalizationMode;
  setLeveling: (enabled: boolean, targetDb?: number, mode?: NormalizationMode) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => boolean;
  addToQueueAtIndex: (index: number, track: Track) => boolean;
  playNext: (track: Track) => Promise<boolean>;
  clearQueue: () => void;
  dedupeQueue: () => void;
  dedupePlaylist: (playlistId: string) => Promise<void>;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  saveQueueAsPlaylist: (name: string) => Promise<void>;
  toggleLike: (track?: Track) => Promise<void>;
  setLiked: (track: Track, liked: boolean, signal?: AbortSignal) => Promise<boolean>;
  shareTrack: (track: Track) => Promise<void>;
  updateLocalTrack: (trackId: string, meta: Partial<Pick<Track, "title" | "artist" | "album" | "genre" | "year">>) => void;
  startWave: () => Promise<void>;
  alarm: AlarmDef | null;
  setAlarm: (alarm: AlarmDef | null) => void;
  fireAlarm: () => Promise<void>;
  previewWave: () => Promise<void>;
  previewTracks: Track[];
  previewLoading: boolean;
  startSmartPlaylist: (type: SmartPlaylistType) => Promise<void>;
  openLocalDirectory: () => Promise<void>;
  addSimilar: () => Promise<void>;
  toggleBlockTrack: (track: Track) => void;
  toggleBlockArtist: (artist: string) => void;
  blockedTrackIds: string[];
  blockedArtists: string[];
  unblockTrack: (id: string) => void;
  unblockArtist: (name: string) => void;
  unblockAllTracks: () => void;
  unblockAllArtists: () => void;
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
   preferredLanguages: string[];
   setPreferredLanguages: (languages: string[]) => void;
   autoGenerateThreshold: number;
   setAutoGenerateThreshold: (threshold: number) => void;
   bassBoost: number;
  setBassBoost: (db: number) => void;
  reverb: number;
  setReverb: (mix: number) => void;
  stereoWidth: number;
  setStereoWidth: (pan: number) => void;
  spatialOrbit: number;
  setSpatialOrbit: (amount: number) => void;
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

export const useApp = create<AppState>()((set, get, api) => ({
  agentSession: null,
  closeAgentSession: () => {
    agentGeneration++;
    const session = get().agentSession;
    session?.dispose();
    if (session) agentRetirement = Promise.all([agentRetirement, session.whenIdle()]).then(() => undefined);
    set({ agentSession: null });
  },
  openAgentSession: async () => {
    if (typeof __WAVE_DESKTOP_AGENT__ === "undefined" || !__WAVE_DESKTOP_AGENT__) throw new Error("Desktop agent unavailable");
    const services = get().services;
    if (!services || !isTauri()) throw new Error("Desktop app is not ready");
    const existing = get().agentSession;
    if (existing) return existing;
    const generation = agentGeneration;
    await agentRetirement;
    if (await invoke<boolean>("desktop_agent_available") !== true) throw new Error("Desktop agent unavailable");
    const { createDesktopAgentSession } = await import("./agentDesktop");
    if (generation !== agentGeneration || get().services !== services) throw new Error("Agent session cancelled");
    if (get().agentSession) return get().agentSession!;
    const session = createDesktopAgentSession(services, get);
    set({ agentSession: session });
    return session;
  },
  services: null,
  ready: false,
  onboardingCompleted: isOnboardingCompleted(),
  snapshot: emptySnapshot,
  position: 0,
  duration: 0,
  likedIds: new Set<string>(),
  localTracks: [],
  notices: [],
  notify: (message, action) => {
    const id = Date.now() + Math.random();
    get().pushLog(message);
    set((s) => ({
      notices: [
        ...s.notices,
        { id, message, actionLabel: action?.label, onAction: action?.run },
      ].slice(-5),
    }));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      get().dismissNotice(id);
    };
    window.setTimeout(finish, 5000);
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
  ...createNavigationSlice(set, get, api),

  playlists: [],
  selectedPlaylistId: null,
  setSelectedPlaylist: (id) => {
    set({ selectedPlaylistId: id });
    get().services?.prewarmer?.prewarm(get().playlists.find((p) => p.id === id)?.tracks ?? []);
  },
  sharedPlaylists: [],
  playlistShares: [],
  loadPlaylists: async () => {
    const { services } = get();
    if (!services) return;
    const pls = await services.storage.getPlaylists();
    set({ playlists: pls });
  },
  createPlaylist: async (name, tracks = [], signal) => {
    signal?.throwIfAborted();
    const { services } = get();
    if (!services) return null;
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
    return playlist;
  },
  importPlaylistFromLink: async (url, signal) => {
    signal?.throwIfAborted();
    const { services } = get();
    if (!services) throw new Error("not ready");
    const { importPlaylistLink } = await import("../core/import/playlistLink");
    const { name, tracks } = await importPlaylistLink(services, url);
    signal?.throwIfAborted();
    if (!tracks.length) throw new Error("No accessible tracks found in this playlist");
    const playlist = await get().createPlaylist(name, tracks, signal);
    if (!playlist) throw new Error("Could not save the imported playlist");
    get().setSelectedPlaylist(playlist.id);
    return tracks.length;
  },
  deletePlaylist: async (id) => {
    const { services } = get();
    if (!services) return;
    const existing = get().playlists.find((p) => p.id === id);
    await services.storage.removePlaylist(id);
    await get().loadPlaylists();
    set((s) => ({ selectedPlaylistId: s.selectedPlaylistId === id ? null : s.selectedPlaylistId }));
    if (existing) {
      get().notify(t("toasts").playlistDeleted, {
        label: t("common").undo,
        run: () => {
          const srv = useApp.getState().services;
          if (!srv) return;
          void srv.storage
            .addPlaylist(existing)
            .then(() => get().loadPlaylists());
        },
      });
    }
  },
  addToPlaylist: async (playlistId, track, signal) => {
    signal?.throwIfAborted();
    const { services } = get();
    if (!services) return null;
    const pl = await services.storage.getPlaylist(playlistId);
    signal?.throwIfAborted();
    if (!pl) return null;
    track = services.recordings?.resolve(track) ?? track;
    if (!pl.trackIds.includes(track.id)) {
      await services.storage.updatePlaylist({ ...pl, trackIds: [...pl.trackIds, track.id],
        tracks: [...(pl.tracks ?? []), track], coverUrl: pl.coverUrl ?? track.coverUrl, updatedAt: Date.now() });
      await get().loadPlaylists();
      return true;
    }
    return false;
  },
  removeFromPlaylist: async (playlistId, trackId) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    const removedIdx = pl.trackIds.indexOf(trackId);
    const removedTrack = pl.tracks?.find((t) => t.id === trackId);
    pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
    pl.tracks = pl.tracks?.filter((t) => t.id !== trackId);
    pl.updatedAt = Date.now();
    await services.storage.updatePlaylist(pl);
    await get().loadPlaylists();
    if (removedTrack && removedIdx >= 0) {
      get().notify(t("toasts").trackRemovedFromPlaylist, {
        label: t("common").undo,
        run: () => {
          const srv = useApp.getState().services;
          if (!srv) return;
          void srv.storage.getPlaylist(playlistId).then((target) => {
            if (!target) return;
            const at = Math.min(Math.max(removedIdx, 0), target.trackIds.length);
            target.trackIds.splice(at, 0, removedTrack.id);
            const tracks = [...(target.tracks ?? [])];
            tracks.splice(at, 0, removedTrack);
            target.tracks = tracks;
            target.updatedAt = Date.now();
            return srv.storage.updatePlaylist(target).then(() => get().loadPlaylists());
          });
        },
      });
    }
  },
  setPlaylistFolder: async (playlistId, folder) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    pl.folder = folder?.trim() ? folder.trim() : undefined;
    pl.updatedAt = Date.now();
    await services.storage.updatePlaylist(pl);
    await get().loadPlaylists();
  },
  setPlaylistCover: async (playlistId, coverUrl) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    pl.coverUrl = coverUrl;
    pl.updatedAt = Date.now();
    await services.storage.updatePlaylist(pl);
    await get().loadPlaylists();
  },
  dedupePlaylist: async (playlistId) => {
    const { services } = get();
    if (!services) return;
    const pl = await services.storage.getPlaylist(playlistId);
    if (!pl) return;
    const seen = new Set<string>();
    const tracks = (pl.tracks ?? []).filter((tr) => {
      if (seen.has(tr.id)) return false;
      seen.add(tr.id);
      return true;
    });
    const removed = (pl.tracks ?? []).length - tracks.length;
    if (removed === 0) {
      get().notify(t("toasts").removedDuplicates(0));
      return;
    }
    pl.tracks = tracks;
    pl.trackIds = tracks.map((tr) => tr.id);
    pl.updatedAt = Date.now();
    await services.storage.updatePlaylist(pl);
    await get().loadPlaylists();
    get().notify(t("toasts").removedDuplicates(removed));
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
    const { getCurrentUser, sharePlaylist: apiShare } = await import("./supabase");
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
    const { getCurrentUser, removeShareByEmail } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    await removeShareByEmail(user.id, playlistId, email);
    await get().loadShares(playlistId);
  },

  loadShares: async (playlistId) => {
    const { getCurrentUser, getPlaylistShares } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    const shares = await getPlaylistShares(user.id, playlistId);
    set({ playlistShares: shares });
  },

  loadSharedPlaylists: async () => {
    const { getCurrentUser, fetchSharedPlaylists } = await import("./supabase");
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

  completeOnboarding: (artistNames: string[]) => {
    persistOnboarding(artistNames);
    set({ onboardingCompleted: true });
    const { services } = get();
    if (services?.wave) {
      services.wave.setOnboardingArtists(artistNames);
    }
  },

  reloadServices: async () => {
    get().closeAgentSession();
    get().cancelArtistRadio();
    const { services } = get();
    services?.prewarmer?.cancel();
    if (!services) return;
    const rebuilt = await reconfigureServices(services);
    set({ services: rebuilt });
    clearVariantsCache();
    void get().loadVariants(rebuilt.engine.snapshot.current);
  },

  refreshLibrary: async () => {
    const { services } = get();
    if (!services) return;
    const liked = await services.library.getLikedTracks();
    set({ likedIds: new Set(liked.map((t) => t.id)) });
  },

  play: async (tracks, index = 0, mode, position) => {
    get().cancelArtistRadio();
    const { services } = get();
    services?.prewarmer?.cancel();
    if (!services) return;
    if (get().radioActive) {
      services.engine.setAutoFill(get().autoContinue ? null : async () => []);
      set({ radioActive: false });
    }
    if (mode === undefined && position === undefined) await services.engine.playTracks(tracks, index);
    else await services.engine.playTracks(tracks, index, mode, position);
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
    cancelAlarmRamp();
    get().services?.engine.setVolume(percent / 100);
  },

  setSpeed: (rate) => {
    get().services?.engine.setPlaybackRate(rate);
  },

  effectsBypassed: false,
  setEffectsBypassed: (bypassed) => {
    get().services?.engine.setEffectsBypassed(bypassed);
    set({ effectsBypassed: bypassed });
  },
  setEqualizer: (gains) => {
    get().services?.engine.setEqualizer(gains);
  },

  setLeveling: (enabled, targetDb, mode = get().levelingMode) => {
    const next = {
      enabled,
      mode,
      targetDb: sanitizeAudioValue(targetDb ?? get().levelingTargetDb, -30, -1, get().levelingTargetDb),
    };
    saveLeveling(next);
    set({ levelingEnabled: next.enabled, levelingTargetDb: next.targetDb, levelingMode: mode });
    get().services?.engine.setLeveling(next.enabled, next.targetDb, mode);
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
    return get().services?.engine.addToQueue(track) ?? false;
  },
  addToQueueAtIndex: (index, track) => {
    const engine = get().services?.engine;
    if (!engine) return false;
    const seq = engine.snapshot.queue;
    const idx = Math.min(Math.max(index, 0), seq.length);
    engine.insertAtQueueIndex(idx, track);
    return true;
  },
  playNext: (track) => {
    return get().services?.engine.playNext(track) ?? Promise.resolve(false);
  },

  clearQueue: () => {
    get().services?.engine.clearQueue();
  },
  dedupeQueue: () => {
    const removed = get().services?.engine.dedupeQueue() ?? 0;
    get().notify(t("toasts").removedDuplicates(removed));
  },

  moveQueueItem: (fromIndex, toIndex) => {
    get().services?.engine.moveInQueue(fromIndex, toIndex);
  },

  removeFromQueue: (index) => {
    const { services, snapshot } = get();
    if (!services) return;
    const track = snapshot.queue[index];
    services.engine.removeFromQueue(index);
    if (track) {
      get().notify(t("toasts").trackRemovedFromQueue, {
        label: t("common").undo,
        run: () => {
          const engine = useApp.getState().services?.engine;
          if (!engine) return;
          const seq = engine.snapshot.queue;
          const idx = Math.min(Math.max(index, 0), seq.length);
          engine.insertAtQueueIndex(idx, track);
        },
      });
    }
  },

  saveQueueAsPlaylist: async (name) => {
    const { services, snapshot } = get();
    if (!services || snapshot.queue.length === 0) return;
    await get().createPlaylist(name, [...snapshot.queue]);
  },

  toggleLike: async (track) => {
    const { services, snapshot } = get();
    const target = track ?? snapshot.current;
    if (!services || !target) return;
    const nowLiked = await services.library.toggleLike(target);
    await get().refreshLibrary();
    get().notify(
      nowLiked ? t("common").like : t("common").unlike,
      { label: t("common").undo, run: () => void useApp.getState().toggleLike(target) },
    );
  },

  setLiked: async (track, liked, signal) => {
    const { services } = get();
    if (!services) throw new Error("App is not ready");
    const result = await services.library.setLiked(track, liked, signal);
    await get().refreshLibrary();
    return result;
  },

  shareTrack: async (track) => {
    const { shareText } = await import("../core/share/trackShare");
    const text = shareText(track);
    if (IS_ANDROID) {
      try {
        await invoke("share_text", { text });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(text);
      get().notify(t("trackMenu").linkCopied);
    } catch {
      get().notify(text);
    }
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
      await get().play(tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  startWave: async () => {
    get().cancelArtistRadio();
    const { services } = get();
    services?.prewarmer?.cancel();
    if (!services) return;
    try {
      const tracks = await services.wave.generateWave(20);
      if (tracks.length === 0) throw new Error("wave is empty");
      await get().play(tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },
  alarm: loadAlarm(),
  setAlarm: (alarm) => {
    saveAlarm(alarm);
    set({ alarm });
    if (IS_ANDROID) {
      if (alarm?.enabled) {
        const atMs = nextAlarmTimestamp(alarm.hour, alarm.minute);
        invoke("schedule_alarm", { id: "wave-alarm", atMs }).catch(() => {});
      } else {
        invoke("cancel_alarm", { id: "wave-alarm" }).catch(() => {});
      }
    }
  },
  fireAlarm: async () => {
    const a = get().alarm;
    try {
      if (a?.mode === "playlist" && a.playlistId) {
        const pl = get().playlists.find((p) => p.id === a.playlistId);
        const tracks = pl?.tracks ?? [];
        if (tracks.length === 0) throw new Error("alarm playlist is empty");
        await get().play(tracks);
      } else {
        await get().startWave();
      }
      // Плавное нарастание за ~30с от 5% до текущей громкости.
      const engine = get().services?.engine;
      const target = engine?.snapshot.volume ?? 1;
      cancelAlarmRamp();
      engine?.setVolume(Math.max(0.01, target * 0.05));
      let step = 0;
      alarmRampTimer = window.setInterval(() => {
        step += 1;
        const eng = get().services?.engine;
        if (!eng) {
          cancelAlarmRamp();
          return;
        }
        eng.setVolume(Math.min(target, target * 0.05 + ((target * 0.95) / 15) * step));
        if (step >= 15) cancelAlarmRamp();
      }, 2000);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
    // Разовый нативный будильник — перевзводим на завтра.
    if (get().alarm?.enabled) get().setAlarm(get().alarm);
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
      await get().play(target.tracks);
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  },

  ...createDownloadsSlice(set, get, api),

  radioActive: false,
  ...createArtistRadioSlice(set, get, api),
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
  levelingEnabled: savedLeveling.enabled,
  levelingTargetDb: savedLeveling.targetDb,
  levelingMode: savedLeveling.mode ?? "adaptive",
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
    get().cancelArtistRadio();
    const { services, snapshot } = get();
    const track = seedTrack ?? snapshot.current;
    if (!services || !track) return;
    try {
      set({ radioActive: true });
      services.engine.setAutoFill(async () => {
        const queue = services.engine.snapshot;
        const last = queue.current;
        if (!last) return [];
        return radioTracks(services, last, queue.queue);
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
  ...createVariantsSlice(set, get, api),

  addSimilar: async () => {
    const { services, snapshot } = get();
    const track = snapshot.current;
    if (!services || !track) return;
    try {
      const similar = uniqueRecommendations(
        await radioTracks(services, track, snapshot.queue), services.engine.snapshot.queue,
      );
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
    if (getBlockedTrackIds().includes(id)) toggleBlockedTrack(id);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },
  unblockArtist: (name) => {
    if (getBlockedArtists().includes(name.trim().toLocaleLowerCase())) toggleBlockedArtist(name);
    set({ blockedTrackIds: getBlockedTrackIds(), blockedArtists: getBlockedArtists() });
  },
  unblockAllTracks: () => {
    clearBlockedTracks();
    set({ blockedTrackIds: [] });
  },
  unblockAllArtists: () => {
    clearBlockedArtists();
    set({ blockedArtists: [] });
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
  compactPlayer: (() => { try { return localStorage.getItem("wave-compact-player") === "1"; } catch { return false; } })(),
  setCompactPlayer: (compact) => {
    localStorage.setItem("wave-compact-player", compact ? "1" : "0");
    set({ compactPlayer: compact });
  },
  lyricsAutoOpen: (() => { try { return localStorage.getItem("wave-lyrics-autoopen") === "1"; } catch { return false; } })(),
  setLyricsAutoOpen: (enabled) => {
    localStorage.setItem("wave-lyrics-autoopen", enabled ? "1" : "0");
    set({ lyricsAutoOpen: enabled });
  },
  lyricsAutoscroll: (() => { try { return localStorage.getItem("wave-lyrics-autoscroll") !== "0"; } catch { return true; } })(),
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
   preferredLanguages: loadPreferredLanguages(),
   setPreferredLanguages: (languages) => {
     savePreferredLanguages(languages);
     set({ preferredLanguages: languages });
     get().services?.wave.setPreferredLanguages(languages);
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
      spatialOrbit: fx.spatialOrbit,
    };
  })(),
  setBassBoost: (db) => {
    const clamped = sanitizeAudioValue(db, 0, 15);
    set({ bassBoost: clamped });
    get().services?.engine.setBassBoost(clamped);
    saveAudioEffects(getAudioEffects(get()));
  },
  setReverb: (mix) => {
    const clamped = sanitizeAudioValue(mix, 0, 1);
    set({ reverb: clamped });
    get().services?.engine.setReverb(clamped);
    saveAudioEffects(getAudioEffects(get()));
  },
  setStereoWidth: (width) => {
    const clamped = sanitizeAudioValue(width, -1, 1);
    set({ stereoWidth: clamped });
    get().services?.engine.setStereoWidth(clamped);
    saveAudioEffects(getAudioEffects(get()));
  },
  setSpatialOrbit: (amount) => {
    const spatialOrbit = sanitizeAudioValue(amount, 0, 1);
    set({ spatialOrbit });
    get().services?.engine.setSpatialOrbit(spatialOrbit);
    saveAudioEffects(getAudioEffects(get()));
  },
}));

function getAudioEffects({ bassBoost, reverb, stereoWidth, spatialOrbit }: AppState) {
  return { bassBoost, reverb, stereoWidth, spatialOrbit };
}

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
        default:
          if (action.startsWith("seek:")) {
            const milliseconds = Number(action.slice(5));
            if (Number.isFinite(milliseconds) && milliseconds >= 0) engine.seek(milliseconds / 1000);
          }
          if (action.startsWith("alarm:")) void get().fireAlarm();
          break;
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
  services.engine.on("startup", ({ provider, outcome, totalMs, phases }) => {
    const stages = Object.entries(phases).map(([name, ms]) => `${name}=${Math.round(ms)}ms`).join(" ");
    get().pushLog(`Playback ${provider}: ${outcome}, ${Math.round(totalMs)}ms (${stages})`);
  });

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
    const source = playbackSource(cur);
    const list = s.variants.filter((v) => v.track.id !== source.id);
    if (list.length === 0) return null;
    const candidate =
      list.find((v) => v.providerId !== source.provider && v.track.uri && !v.track.meta?.noPlay) ??
      list.find((v) => v.providerId !== source.provider) ??
      list[0];
    if (!candidate) return null;
    s.notify(t("toasts").fallbackSwitched(providerLabel(candidate.providerId)));
    return services.recordings?.withSource(cur, candidate.track) ?? candidate.track;
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
    await services.engine.restoreQueue(restore.queue, restore.index, restore.position, restore.mode);
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
  services.engine.setEffectsBypassed(get().effectsBypassed);
  if (savedFx.bassBoost > 0) services.engine.setBassBoost(savedFx.bassBoost);
  if (savedFx.reverb > 0) services.engine.setReverb(savedFx.reverb);
  if (savedFx.stereoWidth !== 0) services.engine.setStereoWidth(savedFx.stereoWidth);
  if (savedFx.spatialOrbit > 0) services.engine.setSpatialOrbit(savedFx.spatialOrbit);

  const savedSpeed = loadSavedSpeed();
  if (savedSpeed !== null && savedSpeed !== 1) {
    services.engine.setPlaybackRate(savedSpeed);
  }
  services.engine.on("speed", () => {
    saveSpeed(services.engine.snapshot.speed);
  });

  if (savedLeveling.enabled) {
    services.engine.setLeveling(true, savedLeveling.targetDb, savedLeveling.mode);
  }

  // Нативные будильники слетают при перезагрузке — перевзводим на старте.
  if (IS_ANDROID && get().alarm?.enabled) {
    const a = get().alarm;
    if (a) {
      invoke("schedule_alarm", { id: "wave-alarm", atMs: nextAlarmTimestamp(a.hour, a.minute) }).catch(() => {});
    }
  }

  // Сеть пропала — предлагаем офлайн-режим вместо молчаливых ошибок стримов.
  watchConnectivity((status) => {
    if (status === "offline") {
      if (!get().offlineMode) {
        get().notify(t("toasts").wentOffline, {
          label: t("toasts").enableOffline,
          run: () => get().setOfflineMode(true),
        });
      }
    } else {
      get().notify(t("toasts").backOnline);
      if (!get().offlineMode) void services.engine.resumeAfterReconnect();
    }
  });
  if (currentConnectivity() === "offline" && !get().offlineMode) {
    get().notify(t("toasts").wentOffline, {
      label: t("toasts").enableOffline,
      run: () => get().setOfflineMode(true),
    });
  }

  bindMediaSession(services, {
    play: () => void services.engine.play(),
    pause: () => services.engine.pause(),
    next: () => void services.engine.next(),
    previous: () => void services.engine.previous(),
    seek: (s) => services.engine.seek(s),
  });

  if (isTauri()) {
    if (!IS_ANDROID) {
      bindMpris(services);
      bindTray(services);
      bindMiniBroadcast(services);
      bindMiniRemote(services);
      bindGlobalHotkeys(services);
      bindDiscord(services);
    }
  }

  let queueSaveTimer: number | undefined;
  const scheduleQueueSave = (): void => {
    window.clearTimeout(queueSaveTimer);
    queueSaveTimer = window.setTimeout(() => {
      const snap = services.engine.snapshot;
      if (snap.queue.length > 0) saveRestore(snap.queue, snap.queueIndex, snap.position, snap.mode);
      else clearRestore();
    }, 600);
  };
  services.engine.on("queue", scheduleQueueSave);
  const saveCurrentQueue = (): void => {
    const snap = services.engine.snapshot;
    if (snap.queue.length && (snap.state === "playing" || snap.state === "paused")) {
      saveRestore(snap.queue, snap.queueIndex, snap.position, snap.mode);
    }
  };
  services.engine.on("state", (state) => {
    if (state === "paused") saveCurrentQueue();
  });
  window.addEventListener("pagehide", saveCurrentQueue);
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
  const bridge = new ApiBridge(services, {
    startArtistRadio: (artist) => get().startArtistRadio(artist),
    play: (tracks, index) => get().play(tracks, index),
  });
  await bridge.start();
  await get().refreshLibrary();
  await get().loadPlaylists();
  if (isTauri()) bindPlugins(services);
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
  if (!isTauri()) return;
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
