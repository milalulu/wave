import type { ToolArguments, ToolName } from "./contract.ts";

type Field = { type: "string"; minLength: number; maxLength: number; enum?: readonly string[] }
  | { type: "number" | "integer"; minimum: number; maximum: number }
  | { type: "boolean" }
  | { type: "array"; items: { type: "number"; minimum: number; maximum: number }; minItems: number; maxItems: number };
export interface ToolDefinition {
  description: string;
  effect: "read" | "playback" | "library";
  parameters: { type: "object"; properties: Record<string, Field>; required: string[]; additionalProperties: false };
}
const text = (maxLength: number): Field => ({ type: "string", minLength: 1, maxLength });
const number = (minimum: number, maximum: number): Field => ({ type: "number", minimum, maximum });
const choice = (...values: string[]): Field => ({ type: "string", minLength: 1, maxLength: 32, enum: values });
const id = text(256);
const page = { offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 50 } } as const;
function define(description: string, effect: ToolDefinition["effect"], properties: Record<string, Field> = {}): ToolDefinition {
  return { description, effect, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

/** JSON Schema subset deliberately kept small for local and cloud models. */
export const AGENT_TOOLS: Record<ToolName, ToolDefinition> = {
  wave_status: define("Read current playback and settings. Use before relative changes or resolving 'this song'.", "read"),
  wave_search: define("Search music without playing it. Only playable returned IDs may be played. Empty results are not success.", "read", { query: text(300), limit: { type: "integer", minimum: 1, maximum: 20 } }),
  wave_play: define("Replace the queue with one known playable track and start it. Use queue_add to preserve the queue.", "playback", { trackId: id }),
  wave_pause: define("Pause playback, preserving position and queue.", "playback"),
  wave_resume: define("Resume the current queue. Does not search or choose a new track.", "playback"),
  wave_next: define("Advance to the next queued track.", "playback"),
  wave_previous: define("Use Wave's previous-track control.", "playback"),
  wave_seek: define("Seek to an absolute position in seconds; it must not exceed the known duration.", "playback", { positionSeconds: number(0, 86400) }),
  wave_volume: define("Set absolute volume in percent, 0 means mute. Read status for relative changes.", "playback", { percent: number(0, 100) }),
  wave_queue: define("Read a page of the queue without changing playback. Offset is zero-based.", "read", page),
  wave_queue_add: define("Insert a known playable track next or at the end; do not interrupt the current track.", "playback", { trackId: id, position: choice("next", "end") }),
  wave_queue_clear: define("Clear the playback queue and stop playback. Does not delete playlists or files.", "playback"),
  wave_playlists: define("List local playlists. Resolve a name to an ID before using it; clarify duplicate names.", "read", page),
  wave_playlist_get: define("Read tracks from a known playlist.", "read", { playlistId: id, ...page }),
  wave_playlist_create: define("Create an empty local playlist and return its generated ID.", "library", { name: text(100) }),
  wave_playlist_add: define("Add a known track to a known playlist. Repeated additions do not create duplicates.", "library", { playlistId: id, trackId: id }),
  wave_playlist_play: define("Replace the queue with a known nonempty playlist and start it.", "playback", { playlistId: id }),
  wave_liked: define("Read a page of liked tracks without starting playback.", "read", page),
  wave_like: define("Set the liked state of a known track explicitly; this is not a toggle.", "library", { trackId: id, liked: { type: "boolean" } }),
  wave_radio: define("Start artist radio, replacing the queue. Requires an unambiguous artist name.", "playback", { artist: text(200) }),
  wave_shuffle: define("Set shuffle explicitly without toggling blindly.", "playback", { enabled: { type: "boolean" } }),
  wave_repeat: define("Set repeat to off, one current track, or all queued tracks.", "playback", { mode: choice("off", "one", "all") }),
  wave_speed: define("Set playback speed from 0.5 to 2.0 inclusive.", "playback", { rate: number(0.5, 2) }),
  wave_equalizer: define("Set 10 band gains in dB, ordered 60,170,310,600,1000,3000,6000,12000,14000,16000 Hz. Read status before changing only some bands.", "playback", { gainsDb: { type: "array", items: { type: "number", minimum: -12, maximum: 12 }, minItems: 10, maxItems: 10 } }),
};

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name);
}

/** Reject rather than coerce, clamp, or silently drop unknown arguments. */
export function validateArguments<K extends ToolName>(name: K, value: unknown): value is ToolArguments[K] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = AGENT_TOOLS[name]?.parameters;
  if (!schema) return false;
  const args = value as Record<string, unknown>;
  if (Object.keys(args).length !== schema.required.length || schema.required.some((key) => !Object.prototype.hasOwnProperty.call(args, key))) return false;
  return Object.entries(schema.properties).every(([key, field]) => {
    const v = args[key];
    switch (field.type) {
      case "string": return typeof v === "string" && v.trim().length >= field.minLength && v.length <= field.maxLength && (!field.enum || field.enum.includes(v));
      case "boolean": return typeof v === "boolean";
      case "number": case "integer": return typeof v === "number" && Number.isFinite(v) && v >= field.minimum && v <= field.maximum && (field.type !== "integer" || Number.isInteger(v));
      case "array": return Array.isArray(v) && v.length >= field.minItems && v.length <= field.maxItems && Array.from(v).every((n) => typeof n === "number" && Number.isFinite(n) && n >= field.items.minimum && n <= field.items.maximum);
    }
  });
}
