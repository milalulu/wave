import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function notConfigured(): never {
  throw new Error("Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing)");
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : new Proxy({} as SupabaseClient, {
      get() {
        return () => notConfigured();
      },
    });

export interface SyncedTrack {
  id: string;
  provider: string;
  uri: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  coverUrl?: string;
  duration?: number;
  genre?: string;
  year?: number;
  meta?: Record<string, unknown>;
  updatedAt: number;
}

export interface SyncedPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  tracks?: SyncedTrack[];
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

export interface UserLikes {
  trackId: string;
  track: SyncedTrack;
  createdAt: number;
}

export interface UserSettings {
  userId: string;
  crossfadeMs: number;
  discoveryRate: number;
  historyDecayDays: number;
  autoGenerateThreshold: number;
  equalizer: number[];
  theme: string;
  accentEnabled: boolean;
  autoContinue: boolean;
  lyricsAutoOpen: boolean;
  lyricsAutoscroll: boolean;
  ytQuality: string;
  offlineMode: boolean;
  downloadDir?: string;
  updatedAt: number;
}

export interface UserDevice {
  id: string;
  userId: string;
  name: string;
  platform: string;
  lastSync: number;
  pushToken?: string;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
}

export function onAuthStateChange(callback: (event: string, session: import("@supabase/supabase-js").Session | null) => void) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function syncLikes(userId: string, localLikes: string[], localTracks: Map<string, SyncedTrack>) {
  const { data: remote } = await supabase
    .from("user_likes")
    .select("track_id, track, created_at")
    .eq("user_id", userId);

  const remoteMap = new Map((remote ?? []).map((r) => [r.track_id, r]));
  const toUpsert: UserLikes[] = [];
  const toDelete: string[] = [];

  for (const trackId of localLikes) {
    const track = localTracks.get(trackId);
    if (!track) continue;
    const remoteItem = remoteMap.get(trackId);
    if (!remoteItem || remoteItem.track.updatedAt < track.updatedAt) {
      
      const createdAt = remoteItem ? new Date(remoteItem.created_at).getTime() : Date.now();
      toUpsert.push({ trackId, track, createdAt });
    }
    remoteMap.delete(trackId);
  }

  for (const [, item] of remoteMap) {
    if (!localLikes.includes(item.track_id)) toDelete.push(item.track_id);
  }

  if (toUpsert.length) {
    await supabase.from("user_likes").upsert(toUpsert.map((t) => ({
      user_id: userId,
      track_id: t.trackId,
      track: t.track,
      created_at: new Date(t.createdAt).toISOString(),
    })));
  }
  if (toDelete.length) {
    await supabase.from("user_likes").delete().eq("user_id", userId).in("track_id", toDelete);
  }
}

export async function fetchRemoteLikes(userId: string): Promise<UserLikes[]> {
  const { data } = await supabase
    .from("user_likes")
    .select("track_id, track, created_at")
    .eq("user_id", userId);
  return (data ?? []).map((r) => ({
    trackId: r.track_id,
    track: r.track as SyncedTrack,
    createdAt: new Date(r.created_at).getTime(),
  }));
}

export async function syncPlaylists(userId: string, local: SyncedPlaylist[]) {
  const { data: remote } = await supabase
    .from("user_playlists")
    .select("id, name, track_ids, tracks, created_at, updated_at, cover_url")
    .eq("user_id", userId);

  const remoteMap = new Map((remote ?? []).map((p) => [p.id, p]));
  const toUpsert: SyncedPlaylist[] = [];
  const toDelete: string[] = [];

  for (const pl of local) {
    const r = remoteMap.get(pl.id);
    
    const remoteTs = r ? new Date(r.updated_at).getTime() : 0;
    if (!r || remoteTs < pl.updatedAt) toUpsert.push(pl);
    remoteMap.delete(pl.id);
  }

  for (const [, item] of remoteMap) toDelete.push(item.id);

  if (toUpsert.length) {
    await supabase.from("user_playlists").upsert(toUpsert.map((p) => ({
      id: p.id,
      user_id: userId,
      name: p.name,
      track_ids: p.trackIds,
      tracks: p.tracks ?? null,
      created_at: new Date(p.createdAt).toISOString(),
      updated_at: new Date(p.updatedAt).toISOString(),
      cover_url: p.coverUrl ?? null,
    })));
  }
  if (toDelete.length) {
    await supabase.from("user_playlists").delete().eq("user_id", userId).in("id", toDelete);
  }
}

export async function fetchRemotePlaylists(userId: string): Promise<SyncedPlaylist[]> {
  const { data } = await supabase
    .from("user_playlists")
    .select("id, name, track_ids, tracks, created_at, updated_at, cover_url")
    .eq("user_id", userId);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    trackIds: p.track_ids,
    tracks: p.tracks as SyncedTrack[] | undefined,
    createdAt: new Date(p.created_at).getTime(),
    updatedAt: new Date(p.updated_at).getTime(),
    coverUrl: p.cover_url ?? undefined,
  }));
}

export async function syncSettings(userId: string, settings: UserSettings) {
  await supabase.from("user_settings").upsert({
    user_id: userId,
    ...settings,
    updated_at: new Date(settings.updatedAt).toISOString(),
  });
}

export async function fetchRemoteSettings(userId: string): Promise<UserSettings | null> {
  const { data } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data ? {
    ...data,
    updatedAt: new Date(data.updated_at).getTime(),
  } : null;
}

export async function registerDevice(userId: string, device: Omit<UserDevice, "userId">) {
  await supabase.from("user_devices").upsert({ ...device, user_id: userId });
}

export async function fetchUserDevices(userId: string): Promise<UserDevice[]> {
  const { data } = await supabase.from("user_devices").select("*").eq("user_id", userId);
  return data ?? [];
}

export interface PlaylistShare {
  id: string;
  playlistId: string;
  ownerId: string;
  collaboratorId: string;
  permission: "editor" | "viewer";
  createdAt: number;
  collaboratorEmail?: string;
}

export async function sharePlaylist(
  ownerId: string,
  playlistId: string,
  collaboratorEmail: string,
  permission: "editor" | "viewer" = "editor",
): Promise<PlaylistShare | null> {
  const { data: profiles, error: lookupError } = await supabase
    .from("auth.users")
    .select("id")
    .eq("email", collaboratorEmail)
    .limit(1);

  if (lookupError || !profiles || profiles.length === 0) return null;

  const collaboratorId = profiles[0].id;
  if (collaboratorId === ownerId) return null;

  const { data, error } = await supabase
    .from("playlist_shares")
    .upsert({
      playlist_id: playlistId,
      owner_id: ownerId,
      collaborator_id: collaboratorId,
      permission,
    }, { onConflict: "playlist_id,owner_id,collaborator_id" })
    .select("id, playlist_id, owner_id, collaborator_id, permission, created_at")
    .single();

  if (error) return null;
  return {
    id: data.id,
    playlistId: data.playlist_id,
    ownerId: data.owner_id,
    collaboratorId: data.collaborator_id,
    permission: data.permission as "editor" | "viewer",
    createdAt: new Date(data.created_at).getTime(),
    collaboratorEmail,
  };
}

export async function removeShare(shareId: string): Promise<void> {
  await supabase.from("playlist_shares").delete().eq("id", shareId);
}

export async function removeShareByEmail(
  ownerId: string,
  playlistId: string,
  collaboratorEmail: string,
): Promise<void> {
  const { data: profiles } = await supabase
    .from("auth.users")
    .select("id")
    .eq("email", collaboratorEmail)
    .limit(1);

  if (!profiles || profiles.length === 0) return;

  await supabase
    .from("playlist_shares")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("owner_id", ownerId)
    .eq("collaborator_id", profiles[0].id);
}

export async function getPlaylistShares(
  ownerId: string,
  playlistId: string,
): Promise<PlaylistShare[]> {
  const { data } = await supabase
    .from("playlist_shares")
    .select("id, playlist_id, owner_id, collaborator_id, permission, created_at")
    .eq("owner_id", ownerId)
    .eq("playlist_id", playlistId);

  return (data ?? []).map((r) => ({
    id: r.id,
    playlistId: r.playlist_id,
    ownerId: r.owner_id,
    collaboratorId: r.collaborator_id,
    permission: r.permission as "editor" | "viewer",
    createdAt: new Date(r.created_at).getTime(),
  }));
}

export async function getMySharedPlaylists(userId: string): Promise<PlaylistShare[]> {
  const { data } = await supabase
    .from("playlist_shares")
    .select("id, playlist_id, owner_id, collaborator_id, permission, created_at")
    .eq("collaborator_id", userId);

  return (data ?? []).map((r) => ({
    id: r.id,
    playlistId: r.playlist_id,
    ownerId: r.owner_id,
    collaboratorId: r.collaborator_id,
    permission: r.permission as "editor" | "viewer",
    createdAt: new Date(r.created_at).getTime(),
  }));
}

export async function fetchSharedPlaylists(userId: string): Promise<SyncedPlaylist[]> {
  const { data: shares } = await supabase
    .from("playlist_shares")
    .select("playlist_id, owner_id")
    .eq("collaborator_id", userId);

  if (!shares || shares.length === 0) return [];

  const results: SyncedPlaylist[] = [];

  for (const share of shares) {
    const { data } = await supabase
      .from("user_playlists")
      .select("id, name, track_ids, tracks, created_at, updated_at, cover_url")
      .eq("user_id", share.owner_id)
      .eq("id", share.playlist_id)
      .single();

    if (data) {
      results.push({
        id: `shared:${share.owner_id}:${data.id}`,
        name: data.name,
        trackIds: data.track_ids,
        tracks: data.tracks as SyncedTrack[] | undefined,
        createdAt: new Date(data.created_at).getTime(),
        updatedAt: new Date(data.updated_at).getTime(),
        coverUrl: data.cover_url ?? undefined,
      });
    }
  }

  return results;
}
