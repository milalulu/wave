/** Model-independent protocol. No runtime, provider credentials or app imports. */
export const AGENT_CONTRACT_VERSION = 1;

export interface ToolArguments {
  wave_status: Record<string, never>;
  wave_search: { query: string; limit: number };
  wave_play: { trackId: string };
  wave_pause: Record<string, never>;
  wave_resume: Record<string, never>;
  wave_next: Record<string, never>;
  wave_previous: Record<string, never>;
  wave_seek: { positionSeconds: number };
  wave_volume: { percent: number };
  wave_queue: { offset: number; limit: number };
  wave_queue_add: { trackId: string; position: "next" | "end" };
  wave_queue_clear: Record<string, never>;
  wave_playlists: { offset: number; limit: number };
  wave_playlist_get: { playlistId: string; offset: number; limit: number };
  wave_playlist_create: { name: string };
  wave_playlist_add: { playlistId: string; trackId: string };
  wave_playlist_play: { playlistId: string };
  wave_liked: { offset: number; limit: number };
  wave_like: { trackId: string; liked: boolean };
  wave_radio: { artist: string };
  wave_shuffle: { enabled: boolean };
  wave_repeat: { mode: "off" | "one" | "all" };
  wave_speed: { rate: number };
  wave_equalizer: { gainsDb: number[] };
}

export type ToolName = keyof ToolArguments;
export type ToolCall = { [K in ToolName]: { type: "tool"; name: K; args: ToolArguments[K] } }[ToolName];
export type AgentDecision = ToolCall | {
  type: "answer" | "clarify" | "unsupported";
  message: string;
};

/** Only public metadata and session-grounded IDs cross the model boundary. */
export interface AgentTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  playable: boolean;
}
export interface AgentPlaylist { id: string; name: string; trackCount: number }
export interface AgentPage<T> { items: T[]; nextOffset: number | null }
export interface AgentStatus {
  state: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  current: AgentTrack | null;
  positionSeconds: number;
  durationSeconds: number | null;
  volumePercent: number;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  speed: number;
  gainsDb: number[];
}

export interface ToolResults {
  wave_status: AgentStatus;
  wave_search: { tracks: AgentTrack[]; incomplete: boolean };
  wave_play: AgentStatus;
  wave_pause: AgentStatus;
  wave_resume: AgentStatus;
  wave_next: AgentStatus;
  wave_previous: AgentStatus;
  wave_seek: AgentStatus;
  wave_volume: AgentStatus;
  wave_queue: AgentPage<AgentTrack> & { currentIndex: number };
  wave_queue_add: { trackId: string; queueLength: number };
  wave_queue_clear: { queueLength: 0; state: "idle" };
  wave_playlists: AgentPage<AgentPlaylist>;
  wave_playlist_get: AgentPlaylist & AgentPage<AgentTrack>;
  wave_playlist_create: AgentPlaylist;
  wave_playlist_add: { playlistId: string; trackId: string; added: boolean };
  wave_playlist_play: AgentStatus;
  wave_liked: AgentPage<AgentTrack>;
  wave_like: { trackId: string; liked: boolean };
  wave_radio: { artist: string; trackCount: number; state: AgentStatus["state"] };
  wave_shuffle: AgentStatus;
  wave_repeat: AgentStatus;
  wave_speed: AgentStatus;
  wave_equalizer: AgentStatus;
}

export type AgentErrorCode = "invalid_arguments" | "unknown_tool" | "unknown_reference"
  | "not_found" | "not_playable" | "empty_queue" | "out_of_range" | "provider_unavailable"
  | "cancelled" | "timeout" | "platform_unavailable" | "internal_error";
export type ToolResult<K extends ToolName> = {
  ok: true;
  data: ToolResults[K];
} | {
  ok: false;
  error: { code: AgentErrorCode; message: string; retryable: boolean };
};
