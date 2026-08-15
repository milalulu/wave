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
      toUpsert.push({ trackId, track, createdAt: Date.now() });
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
    if (!r || r.updated_at < pl.updatedAt) toUpsert.push(pl);
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
