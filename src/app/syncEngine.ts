import { useApp } from "./stores";
import { type SyncedTrack, type SyncedPlaylist, syncLikes, fetchRemoteLikes, syncPlaylists, fetchRemotePlaylists, syncSettings, fetchRemoteSettings } from "./supabase";
import { loadYtQuality } from "./ytQuality";

function getYtQuality(): string {
  return loadYtQuality();
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

function mapTrackToSynced(track: ReturnType<typeof useApp.getState>["localTracks"][0]): SyncedTrack {
  return {
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
    updatedAt: Date.now(),
  };
}

function mapPlaylistToSynced(pl: ReturnType<typeof useApp.getState>["playlists"][0]): SyncedPlaylist {
  return {
    id: pl.id,
    name: pl.name,
    trackIds: pl.trackIds,
    tracks: pl.tracks?.map(mapTrackToSynced),
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
      const localTracksMap = new Map(state.localTracks.map(mapTrackToSynced).map((t) => [t.id, t]));
      for (const pl of state.playlists) {
        if (pl.tracks) {
          for (const t of pl.tracks) {
            if (!localTracksMap.has(t.id)) localTracksMap.set(t.id, mapTrackToSynced(t));
          }
        }
      }

      await Promise.all([
        syncLikes(user.id, state.likedIds, localTracksMap),
        syncPlaylists(user.id, state.playlists.map(mapPlaylistToSynced)),
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
    const [likes, playlists, settings] = await Promise.all([
      fetchRemoteLikes(userId),
      fetchRemotePlaylists(userId),
      fetchRemoteSettings(userId),
    ]);

    const state = useApp.getState();
    const newLikedIds = [...new Set([...state.likedIds, ...likes.map((l) => l.trackId)])];

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
    for (const remote of playlists) {
      if (!remotePlaylistMap.has(remote.id)) {
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
