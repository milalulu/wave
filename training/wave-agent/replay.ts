import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AgentConversation } from "../../src/core/agent/AgentConversation";
import { AgentExecutor } from "../../src/core/agent/AgentExecutor";
import { WaveAgentTools, type WaveAgentHost } from "../../src/core/agent/WaveAgentTools";
import { AgentFault } from "../../src/core/agent/execution";
import { isAgentDecision } from "../../src/core/agent/decision";
import { structuredMessages } from "../../src/core/agent/protocol";
import type { AgentDecision, AgentErrorCode, ToolName } from "../../src/core/agent/contract";
import type { ModelMessage } from "../../src/core/agent/model";
import { PlayerEngine } from "../../src/core/player/PlayerEngine";
import { MockAudioAdapter } from "../../src/core/player/PlayerAdapter";
import { MemoryStorage } from "../../src/core/database/MemoryStorage";
import type { Track, Playlist } from "../../src/core/types";

type Step = { name: ToolName; args: Record<string, unknown>; as: string; error?: AgentErrorCode }
  | { type: "answer" | "clarify" | "unsupported"; message: string };
export interface Scenario {
  id: string; family: string; split: "train" | "dev" | "holdout"; language: "ru" | "en";
  critical: boolean; rubric: string; readOnly?: boolean;
  fixture: {
    tracks: { key: string; title: string; artist: string; duration?: number; playable?: boolean }[];
    search: Record<string, string[]>; searchError?: "provider_unavailable" | "cancelled";
    playlists?: { name: string; tracks: string[] }[]; queue?: string[]; liked?: string[];
    state?: "paused" | "loading"; volume?: number; position?: number;
  };
  turns: { user: string; steps: Step[]; expect: Record<string, unknown> }[];
}
export interface Sample {
  id: string; dialogueId: string; family: string; split: Scenario["split"]; language: Scenario["language"];
  critical: boolean; rubric: string; prompt: ModelMessage[]; completion: ModelMessage[];
}

/** Resolve only explicit receipt paths. Names never become executable IDs. */
export function resolveReferences(value: unknown, receipts: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveReferences(v, receipts));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$ref" in obj) {
      assert.deepEqual(Object.keys(obj), ["$ref"]);
      assert.equal(typeof obj.$ref, "string");
      let found: unknown = receipts;
      for (const part of (obj.$ref as string).split(".")) {
        assert(found && typeof found === "object" && Object.hasOwn(found, part), `Missing receipt path ${obj.$ref}`);
        found = (found as Record<string, unknown>)[part];
      }
      assert.equal(typeof found, "string", "References must resolve to IDs");
      return found;
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveReferences(v, receipts)]));
  }
  return value;
}

/** Stable, per-dialogue pseudonymous UUIDs; retain exact reference relationships. */
function canonicalize<T>(value: T, id: string): T {
  const ids = new Map<string, string>();
  return JSON.parse(JSON.stringify(value).replace(/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi, (uuid) => {
    if (!ids.has(uuid)) {
      const h = createHash("sha256").update(`${id}:${ids.size}`).digest("hex");
      ids.set(uuid, `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`);
    }
    return ids.get(uuid)!;
  }));
}

export async function replay(scenario: Scenario): Promise<{ samples: Sample[]; trace: unknown[] }> {
  const audio = new MockAudioAdapter();
  const engine = new PlayerEngine(audio);
  const storage = new MemoryStorage();
  const tracks = new Map(scenario.fixture.tracks.map((t) => [t.key, { id: `internal-${t.key}`, title: t.title,
    artist: t.artist, provider: "local", uri: `fixture:///${t.key}`, duration: t.duration ?? 240 } satisfies Track]));
  const track = (key: string) => { const value = tracks.get(key); assert(value, `Unknown fixture ${key}`); return value; };
  const key = (t: Track) => { const found = [...tracks].find(([, v]) => v.id === t.id); assert(found); return found[0]; };
  const port: WaveAgentHost = {
    engine, storage,
    search: async (query) => {
      if (scenario.fixture.searchError) throw new AgentFault(scenario.fixture.searchError);
      assert(Object.hasOwn(scenario.fixture.search, query), `Unspecified search fixture: ${query}`);
      return { tracks: scenario.fixture.search[query].map(track), incomplete: false };
    },
    prepareTrack: (t) => t,
    playable: (t) => scenario.fixture.tracks.find((f) => f.key === key(t))?.playable !== false,
    play: async (items, signal) => { signal.throwIfAborted(); await engine.playTracks(items); },
    playback: async (action) => { if (action === "resume") await engine.play(); else if (action === "next") await engine.next(); else await engine.previous(); },
    pause: () => engine.pause(), clearQueue: () => engine.clearQueue(), setVolume: (v) => engine.setVolume(v / 100),
    setSpeed: (v) => engine.setPlaybackRate(v), setEqualizer: (v) => engine.setEqualizer(v),
    createPlaylist: async (name, signal) => {
      signal.throwIfAborted(); const p: Playlist = { id: crypto.randomUUID(), name, tracks: [], trackIds: [], createdAt: 0, updatedAt: 0 };
      await storage.addPlaylist(p); return p;
    },
    addToPlaylist: async (id, item, signal) => {
      signal.throwIfAborted(); const p = await storage.getPlaylist(id); assert(p);
      if (p.trackIds.includes(item.id)) return false;
      await storage.updatePlaylist({ ...p, tracks: [...p.tracks ?? [], item], trackIds: [...p.trackIds, item.id] }); return true;
    },
    setLiked: async (item, liked) => { if (liked) await storage.addLikedTrack(item); else await storage.removeLikedTrack(item.id); return liked; },
    radio: async (artist, signal) => {
      const items = [...tracks.values()].filter((t) => t.artist === artist); assert(items.length);
      signal.throwIfAborted(); await engine.playTracks(items); return { artist, trackCount: items.length };
    },
  };
  for (const p of scenario.fixture.playlists ?? []) await storage.addPlaylist({ id: crypto.randomUUID(), name: p.name,
    trackIds: p.tracks.map((k) => track(k).id), tracks: p.tracks.map(track), createdAt: 0, updatedAt: 0 });
  for (const k of scenario.fixture.liked ?? []) await storage.addLikedTrack(track(k));
  if (scenario.fixture.queue?.length) await engine.playTracks(scenario.fixture.queue.map(track));
  if (scenario.fixture.state) audio.setState(scenario.fixture.state);
  engine.setVolume((scenario.fixture.volume ?? 100) / 100);
  if (scenario.fixture.position) audio.tick(scenario.fixture.position);
  const executor = new AgentExecutor(new WaveAgentTools(port));
  const receipts: Record<string, unknown> = {};
  let steps: Step[] = []; let cursor = 0; let pending: string | undefined;
  const samples: Sample[] = []; const trace: unknown[] = [];
  const conversation = new AgentConversation({ complete: async (messages) => {
    if (pending) {
      const receipt = JSON.parse(messages[messages.length - 1].content);
      assert.equal(receipt.type, "tool_result"); receipts[pending] = receipt.result; pending = undefined;
    }
    const step = steps[cursor++]; assert(step, "Unexpected extra model call");
    const decision: unknown = "name" in step ? { type: "tool", name: step.name, args: resolveReferences(step.args, receipts) } : step;
    assert(isAgentDecision(decision), "Invalid teacher decision");
    if ("name" in step) pending = step.as;
    samples.push({ id: `${scenario.id}:${samples.length + 1}`, dialogueId: scenario.id, family: scenario.family,
      split: scenario.split, language: scenario.language, critical: scenario.critical, rubric: scenario.rubric,
      prompt: structuredMessages(messages), completion: [{ role: "assistant", content: JSON.stringify({ decision }) }] });
    return JSON.stringify(decision);
  } }, executor, { compactContext: true, readOnly: scenario.readOnly });
  try {
    for (const turn of scenario.turns) {
      steps = turn.steps; cursor = 0; pending = undefined;
      const before = conversation.getSnapshot().events.length;
      await conversation.send(turn.user);
      assert.equal(cursor, steps.length, `${scenario.id}: teacher trajectory stopped early`);
      const events = conversation.getSnapshot().events.slice(before);
      assert(!events.some((e) => e.type === "error"), `${scenario.id}: controller error`);
      const calls = events.filter((e) => e.type === "tool");
      const expected = steps.filter((s) => "name" in s);
      assert.equal(calls.length, expected.length);
      calls.forEach((e, i) => {
        receipts[expected[i].as] = e.result;
        assert.equal(e.result.ok ? undefined : e.result.error.code, expected[i].error, `${scenario.id}: unexpected tool failure`);
      });
      const s = engine.snapshot;
      const actual: Record<string, unknown> = { state: s.state, current: s.current ? key(s.current) : null,
        queue: s.queue.map(key), volume: s.volume * 100, position: s.position, speed: s.speed, shuffle: s.shuffle,
        repeat: s.repeat, gainsDb: s.equalizer, liked: (await storage.getLikedTracks()).map(key),
        playlists: (await storage.getPlaylists()).map((p) => ({ name: p.name, tracks: (p.tracks ?? []).map(key) })) };
      assert(Object.keys(turn.expect).length >= 2, "Each turn needs state and preservation checks");
      for (const [field, value] of Object.entries(turn.expect)) assert.deepEqual(actual[field], value, `${scenario.id}: ${field}`);
      trace.push({ user: turn.user, events, state: actual });
    }
    assert(!JSON.stringify(samples).includes("fixture:///"));
    assert(!JSON.stringify(samples).includes('"internal-'));
    return canonicalize({ samples, trace }, scenario.id);
  } finally { conversation.dispose(); executor.dispose(); await executor.whenIdle(); engine.destroy(); }
}

export const decisionOf = (sample: Sample): AgentDecision => JSON.parse(sample.completion[0].content).decision;
