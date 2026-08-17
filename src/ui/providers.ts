export const PROVIDER_LABELS: Record<string, string> = {
  itunes: "iTunes",
  youtube: "YT Music",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  vk: "VK",
  deezer: "Deezer",
  lastfm: "Last.fm",
  musicbrainz: "MusicBrainz",
  local: "Local",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}
