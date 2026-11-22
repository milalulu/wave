import { useApp } from "./stores";
import { type SyncedTrack, type SyncedPlaylist, type PlaybackStateSync } from "./supabase";
import type { Track } from "../core/types";
import { t } from "../core/i18n";
import { loadRestore } from "./queueRestore";
import { isStreamingProvider } from "./platformSettings";
import { isLocalMediaUri } from "../core/util/localMedia";

const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function shouldOfferContinue(
  remote: PlaybackStateSync | null,
  localTrackId: string | null,
  sessionStart: number,
  localPosition?: number,
): remote is PlaybackStateSync & { track: Track } {
  if (!remote?.track || remote.queue.length === 0) return false;
  if (!(remote.updatedAt > sessionStart)) return false;
  if (remote.track.id === localTrackId && (localPosition === undefined || remote.position <= localPosition + 15)) return false;
  return true;
}
import { loadYtQuality } from "./ytQuality";

function getYtQuality(): string {
  return loadYtQuality();
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let unsubscribePlayback: (() => void) | undefined;
let isSyncing = false;
let syncGeneration = 0;

export async function savePlaybackCheckpoint(userId: string): Promise<boolean> {
  const { snapshot, position, services } = useApp.getState();
  if (!snapshot.current || !snapshot.queue.length || !["playing", "paused"].includes(snapshot.state)) return false;
  const start = Math.max(0, Math.min(snapshot.queueIndex - 150, snapshot.queue.length - 300));
  const portable = (track: Track) => isStreamingProvider(track.provider) && !isLocalMediaUri(track.uri) && !track.id.startsWith("local:");
  if (!portable(snapshot.current)) return false;
  const queue = snapshot.queue.slice(start, start + 300);
  const index = queue.slice(0, snapshot.queueIndex - start).filter(portable).length;
  const positionAtSave = services?.engine?.getPlaybackPosition?.() ?? position ?? snapshot.position ?? 0;
  const { syncPlaybackState } = await import("./supabase");
  await syncPlaybackState(userId, {
    track: snapshot.current,
    queue: queue.filter(portable),
    index,
    position: positionAtSave,
    mode: snapshot.mode,
  });
  return true;
}

export async function getPlaybackHandoff(userId: string) {
  const { fetchPlaybackState } = await import("./supabase");
  const remote = await fetchPlaybackState(userId);
  const state = useApp.getState();
  const since = Math.max(Date.now() - HANDOFF_MAX_AGE_MS, loadRestore()?.savedAt ?? 0);
  return shouldOfferContinue(remote, state.snapshot.current?.id ?? null, since, state.position) ? remote : null;
}

export function resumePlaybackHandoff(remote: PlaybackStateSync): Promise<void> {
  const idx = Math.min(Math.max(remote.index, 0), Math.max(remote.queue.length - 1, 0));
  return useApp.getState().play(remote.queue, idx, remote.mode ?? "normal", remote.position);
}

const SYNC_STAMP_KEY = "wave:sync-track-stamps";

interface TrackStamp {
  hash: string;
  updatedAt: number;
}

function loadStamps(): Record<string, TrackStamp> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_STAMP_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStamps(stamps: Record<string, TrackStamp>): void {
  try {
    localStorage.setItem(SYNC_STAMP_KEY, JSON.stringify(stamps));
  } catch {
    
  }
}

function mapTrackToSynced(
  track: ReturnType<typeof useApp.getState>["localTracks"][0],
  stamps: Record<string, TrackStamp>,
): SyncedTrack {
  const payload: SyncedTrack = {
    id: track.id,
    provider: track.provider,
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    coverUrl: track.coverUrl,
    duration: track.duration,
    genre: track.genre,
    year: track.year,
    meta: track.meta,
    updatedAt: 0,
  };
  const hash = JSON.stringify({ ...payload, updatedAt: undefined });
  const prev = stamps[track.id];
  if (prev && prev.hash === hash) {
    payload.updatedAt = prev.updatedAt;
  } else {
    payload.updatedAt = Date.now();
    stamps[track.id] = { hash, updatedAt: payload.updatedAt };
  }
  return payload;
}

function mapPlaylistToSynced(
  pl: ReturnType<typeof useApp.getState>["playlists"][0],
  stamps: Record<string, TrackStamp>,
): SyncedPlaylist {
  return {
    id: pl.id,
    name: pl.name,
    trackIds: pl.trackIds,
    tracks: pl.tracks?.map((t) => mapTrackToSynced(t, stamps)),
    createdAt: pl.createdAt,
    updatedAt: pl.updatedAt,
    coverUrl: pl.coverUrl,
  };
}

export function startSyncEngine(userId?: string) {
  if (syncInterval) return;
  const generation = ++syncGeneration;

  const doSync = async () => {
    if (isSyncing) return;
    const { getCurrentUser, syncLikes, syncPlaylists, syncSettings } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user || (userId && user.id !== userId) || generation !== syncGeneration || isSyncing) return;
    isSyncing = true;

    try {
      const state = useApp.getState();
      if (!state.services || state.services.storageBackend === "memory") return;
      const likedTracks = await state.services.library.getLikedTracks();
      if (generation !== syncGeneration) return;
      const stamps = loadStamps();
      const usedIds = new Set<string>();
      const localTracksMap = new Map(
        [...state.localTracks, ...likedTracks].map((t) => {
          usedIds.add(t.id);
          return [t.id, mapTrackToSynced(t, stamps)];
        }),
      );
      for (const pl of state.playlists) {
        if (pl.tracks) {
          for (const t of pl.tracks) {
            usedIds.add(t.id);
            if (!localTracksMap.has(t.id)) localTracksMap.set(t.id, mapTrackToSynced(t, stamps));
          }
        }
      }

      await Promise.all([
        syncLikes(user.id, [...state.likedIds], localTracksMap),
        syncPlaylists(user.id, state.playlists.map((p) => mapPlaylistToSynced(p, stamps))),
        syncSettings(user.id, {
          userId: user.id,
          crossfadeMs: state.crossfadeMs,
          discoveryRate: state.discoveryRate,
          historyDecayDays: state.historyDecayDays,
          preferredLanguages: state.preferredLanguages,
          autoGenerateThreshold: state.autoGenerateThreshold,
          equalizer: state.snapshot.equalizer,
          theme: state.theme,
          accentEnabled: state.accentEnabled,
          autoContinue: state.autoContinue,
          lyricsAutoOpen: state.lyricsAutoOpen,
          lyricsAutoscroll: state.lyricsAutoscroll,
          ytQuality: getYtQuality(),
          offlineMode: state.offlineMode,
          updatedAt: Date.now(),
        }),
      ]);

      if (generation !== syncGeneration) return;
      if (useApp.getState().snapshot.state === "playing") await savePlaybackCheckpoint(user.id);

      
      for (const id of Object.keys(stamps)) {
        if (!usedIds.has(id)) delete stamps[id];
      }
      saveStamps(stamps);
    } catch (e) {
      console.error("[Sync] failed:", e);
    } finally {
      isSyncing = false;
    }
  };

  doSync();
  syncInterval = setInterval(doSync, 60_000);
  if (userId) unsubscribePlayback = useApp.subscribe((state, previous) => {
    if (state.snapshot.state === "paused" && previous.snapshot.state === "playing") {
      void savePlaybackCheckpoint(userId).catch(() => {});
    }
  });
}

export function stopSyncEngine() {
  syncGeneration++;
  unsubscribePlayback?.();
  unsubscribePlayback = undefined;
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

export async function pullRemoteData(userId: string, isCurrent: () => boolean = () => true) {
  try {
    const { fetchRemoteLikes, fetchRemotePlaylists, fetchRemoteSettings, fetchSharedPlaylists, fetchPlaybackState } =
      await import("./supabase");
    const [likes, playlists, settings, sharedPlaylists] = await Promise.all([
      fetchRemoteLikes(userId),
      fetchRemotePlaylists(userId),
      fetchRemoteSettings(userId),
      fetchSharedPlaylists(userId),
    ]);
    const remotePlayback = await fetchPlaybackState(userId).catch(() => null);
    if (!isCurrent()) return;

    const state = useApp.getState();
    const recordings = state.services?.recordings;
    const newLikedIds = new Set([...state.likedIds, ...likes.map((l) => l.trackId)]
      .map((id) => recordings?.id(id) ?? id));

    const remotePlaylistMap = new Map(playlists.map((p) => [p.id, p]));
    const mergedPlaylists = state.playlists.map((pl) => {
      const remote = remotePlaylistMap.get(pl.id);
      if (remote && remote.updatedAt > pl.updatedAt) {
        return {
          ...pl,
          name: remote.name,
          trackIds: remote.trackIds,
          tracks: remote.tracks,
          updatedAt: remote.updatedAt,
          coverUrl: remote.coverUrl,
        };
      }
      return pl;
    });
    const mergedIds = new Set(mergedPlaylists.map((p) => p.id));
    for (const remote of playlists) {
      if (!mergedIds.has(remote.id)) {
        mergedPlaylists.push({
          id: remote.id,
          name: remote.name,
          trackIds: remote.trackIds,
          tracks: remote.tracks,
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
          coverUrl: remote.coverUrl,
        });
      }
    }

    for (const sp of sharedPlaylists) {
      if (!mergedIds.has(sp.id)) {
        mergedPlaylists.push(sp);
      }
    }

    useApp.setState({
      likedIds: newLikedIds,
      playlists: recordings ? mergedPlaylists.map((pl) => ({
        ...pl,
        trackIds: pl.trackIds.map((id) => recordings.id(id)),
        tracks: pl.tracks?.map((track) => recordings.resolve(track)),
      })) : mergedPlaylists,
    });

    if (settings) {
      state.setCrossfadeMs(settings.crossfadeMs);
      state.setDiscoveryRate(settings.discoveryRate);
      state.setHistoryDecayDays(settings.historyDecayDays);
      state.setPreferredLanguages(settings.preferredLanguages ?? []);
      state.setAutoGenerateThreshold(settings.autoGenerateThreshold);
      state.setEqualizer(settings.equalizer);
      state.setTheme(settings.theme as import("./themeStore").Theme);
      state.setAccentEnabled(settings.accentEnabled);
      state.setAutoContinue(settings.autoContinue);
      state.setLyricsAutoOpen(settings.lyricsAutoOpen);
      state.setLyricsAutoscroll(settings.lyricsAutoscroll);
    }

    const local = loadRestore();
    if (state.snapshot.state !== "playing" && shouldOfferContinue(
      remotePlayback, state.snapshot.current?.id ?? null,
      Math.max(Date.now() - HANDOFF_MAX_AGE_MS, local?.savedAt ?? 0), state.position,
    )) {
      const remote = remotePlayback;
      state.notify(t("toasts").continueListening(remote.track.title), {
        label: t("toasts").continueAction,
        run: () => {
          if (!isCurrent()) return;
          void resumePlaybackHandoff(remote);
        },
      });
    }
  } catch (e) {
    console.error("[Sync] pull failed:", e);
  }
}
