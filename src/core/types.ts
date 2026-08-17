export type RepeatMode = "off" | "all" | "one";

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface Track {
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
}

export interface Artist {
  id: string;
  provider: string;
  name: string;
  coverUrl?: string;
  meta?: Record<string, unknown>;
}

export interface Album {
  id: string;
  provider: string;
  title: string;
  artist?: string;
  coverUrl?: string;
  year?: number;
  trackCount?: number;
  meta?: Record<string, unknown>;
}

export interface AlbumDetail {
  album: Album;
  tracks: Track[];
}

export interface ArtistDetail {
  artist: Artist;
  topTracks: Track[];
  albums: Album[];
}

export interface SearchResults {
  provider: string;
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[]; 
  
  tracks?: Track[];
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

export interface PlayerSnapshot {
  state: PlayerState;
  current: Track | null;
  position: number;
  duration: number;
  volume: number;
  speed: number;
  equalizer: number[];
  shuffle: boolean;
  repeat: RepeatMode;
  queue: Track[];
  queueIndex: number;
  history: Track[];
}
