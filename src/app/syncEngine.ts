import { useApp } from "./stores";
import { type SyncedTrack, type SyncedPlaylist, syncLikes, fetchRemoteLikes, syncPlaylists, fetchRemotePlaylists, syncSettings, fetchRemoteSettings, fetchSharedPlaylists } from "./supabase";
import { loadYtQuality } from "./ytQuality";

function getYtQuality(): string {
  return loadYtQuality();
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

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

export function startSyncEngine() {
  if (syncInterval) return;

  const doSync = async () => {
    if (isSyncing) return;
    const { getCurrentUser } = await import("./supabase");
    const user = await getCurrentUser();
    if (!user) return;
    isSyncing = true;

    try {
      const state = useApp.getState();
      const stamps = loadStamps();
      const usedIds = new Set<string>();
      const localTracksMap = new Map(
        state.localTracks.map((t) => {
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
}

export function stopSyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

export async function pullRemoteData(userId: string) {
  try {
    const [likes, playlists, settings, sharedPlaylists] = await Promise.all([
      fetchRemoteLikes(userId),
      fetchRemotePlaylists(userId),
      fetchRemoteSettings(userId),
      fetchSharedPlaylists(userId),
    ]);

    const state = useApp.getState();
    const newLikedIds = new Set([...state.likedIds, ...likes.map((l) => l.trackId)]);

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

    useApp.setState({ likedIds: newLikedIds, playlists: mergedPlaylists });

    if (settings) {
      state.setCrossfadeMs(settings.crossfadeMs);
      state.setEqualizer(settings.equalizer);
      state.setTheme(settings.theme as import("./themeStore").Theme);
      state.setAccentEnabled(settings.accentEnabled);
      state.setAutoContinue(settings.autoContinue);
      state.setLyricsAutoOpen(settings.lyricsAutoOpen);
      state.setLyricsAutoscroll(settings.lyricsAutoscroll);
    }
  } catch (e) {
    console.error("[Sync] pull failed:", e);
  }
}
