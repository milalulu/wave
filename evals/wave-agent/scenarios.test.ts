import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdir, writeFile, readFile, open, unlink, type FileHandle } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { AgentConversation } from "../../src/core/agent/AgentConversation";
import { AgentExecutor } from "../../src/core/agent/AgentExecutor";
import { WaveAgentTools, type WaveAgentHost } from "../../src/core/agent/WaveAgentTools";
import { AgentFault } from "../../src/core/agent/execution";
import { AGENT_TOOLS } from "../../src/core/agent/catalog";
import { AGENT_RUNTIME_PROMPT } from "../../src/core/agent/prompt";
import { ModelError, type AgentModel, type ModelMessage } from "../../src/core/agent/model";
import { PlayerEngine } from "../../src/core/player/PlayerEngine";
import { MockAudioAdapter } from "../../src/core/player/PlayerAdapter";
import { MemoryStorage } from "../../src/core/database/MemoryStorage";
import type { Playlist, Track } from "../../src/core/types";
import { DEFAULT_OPTIONS, hardware, requestJson, sha256 } from "../../scripts/agent-benchmark-lib.mjs";

const modelName = process.env.WAVE_BENCHMARK_MODEL;
const output = process.env.WAVE_BENCHMARK_OUT;
if (!modelName || !output) throw new Error("Set WAVE_BENCHMARK_MODEL and WAVE_BENCHMARK_OUT to run isolated model scenarios");
const host = "http://127.0.0.1:11434";
const rows: unknown[] = [];
const metadata: Record<string, unknown> = {};
let ownsModel = false;
const lockPath = join(tmpdir(), `wave-benchmark-${sha256(host).slice(0, 16)}.lock`);
let lock: FileHandle | undefined;

beforeAll(async () => {
  lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, model: modelName }));
  const ps = await requestJson(host, "/api/ps");
  if (ps.models?.length) throw new Error("Finish other model work first; loaded models were not stopped");
  const tags = await requestJson(host, "/api/tags");
  const tag = tags.models?.find((m: { name: string }) => m.name === modelName);
  if (!tag || tag.details?.format !== "gguf" || modelName.includes("cloud")) throw new Error("Installed local GGUF model required");
  const info = await requestJson(host, "/api/show", { model: modelName });
  if (info.remote_host || info.remote_model) throw new Error("Remote models are excluded");
  await mkdir(output, { recursive: false });
  Object.assign(metadata, { model: modelName, digest: tag.digest, hardware: hardware(), runtimeVersion: (await requestJson(host, "/api/version")).version,
    options: DEFAULT_OPTIONS, think: false, format: "json", startedAt: new Date().toISOString(),
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    scenarioSourceSha256: sha256(await readFile(new URL("./scenarios.test.ts", import.meta.url))),
    runtimePromptSha256: sha256(AGENT_RUNTIME_PROMPT), toolsSha256: sha256(JSON.stringify(AGENT_TOOLS)),
    engine: "Real PlayerEngine, MemoryStorage, WaveAgentTools, AgentExecutor and AgentConversation with MockAudioAdapter",
    limitations: "No production library, real audio output, app UI or provider network. Final model text needs manual review." });
  await writeFile(join(output, "scenarios.source.txt"), await readFile(new URL("./scenarios.test.ts", import.meta.url)));
});
afterAll(async () => {
  try {
    if (!metadata.startedAt) return;
    try {
      if (ownsModel) await requestJson(host, "/api/chat", { model: modelName, messages: [], stream: false, keep_alive: 0 }, { timeoutMs: 20000 });
      metadata.modelUnloadConfirmed = !(await requestJson(host, "/api/ps")).models?.some((m: { name: string }) => m.name === modelName);
    } finally {
      metadata.finishedAt = new Date().toISOString();
      await writeFile(join(output, "scenarios.json"), JSON.stringify({ metadata, rows }, null, 2) + "\n");
    }
  } finally { if (lock) { await lock.close(); await unlink(lockPath); } }
});

const track: Track = { id: "fixture-internal-northlight", title: "Northlight", artist: "Paper Moons", provider: "local", uri: "fixture:///northlight", duration: 180 };
const original: Track = { ...track, id: "fixture-internal-home", title: "Home", uri: "fixture:///home" };
function fixture() {
  const audio = new MockAudioAdapter();
  const engine = new PlayerEngine(audio);
  const storage = new MemoryStorage();
  const port: WaveAgentHost = {
    engine, storage, search: async (query) => ({ tracks: /northlight|paper moons/i.test(query) ? [track] : [], incomplete: false }),
    prepareTrack: (t) => t, playable: () => true,
    play: async (tracks, signal) => { signal.throwIfAborted(); await engine.playTracks(tracks); },
    playback: async (action) => { if (action === "resume") await engine.play(); else if (action === "next") await engine.next(); else await engine.previous(); },
    pause: () => engine.pause(), clearQueue: () => engine.clearQueue(), setVolume: (percent) => engine.setVolume(percent / 100),
    setSpeed: (rate) => engine.setPlaybackRate(rate), setEqualizer: (gains) => engine.setEqualizer(gains),
    createPlaylist: async (name, signal) => {
      signal.throwIfAborted();
      const playlist: Playlist = { id: crypto.randomUUID(), name, trackIds: [], tracks: [], createdAt: Date.now(), updatedAt: Date.now() };
      await storage.addPlaylist(playlist); return playlist;
    },
    addToPlaylist: async (id, item, signal) => {
      signal.throwIfAborted(); const playlist = await storage.getPlaylist(id);
      if (!playlist) throw new AgentFault("not_found");
      if (playlist.trackIds.includes(item.id)) return false;
      await storage.updatePlaylist({ ...playlist, tracks: [...playlist.tracks ?? [], item], trackIds: [...playlist.trackIds, item.id] }); return true;
    },
    setLiked: async (item, liked) => { if (liked) await storage.addLikedTrack(item); else await storage.removeLikedTrack(item.id); return liked; },
    radio: async () => { throw new AgentFault("provider_unavailable"); },
  };
  const outputs: unknown[] = [];
  const model: AgentModel = { complete: async (messages: readonly ModelMessage[], signal) => {
    // Public projections must be the only model-visible track data.
    if (JSON.stringify(messages).includes("fixture:///")) throw new ModelError("internal_error");
    ownsModel = true;
    const start = performance.now();
    let response;
    try {
      response = await requestJson(host, "/api/chat", { model: modelName, messages, stream: false, format: "json", think: false,
        keep_alive: "5m", options: DEFAULT_OPTIONS }, { signal, timeoutMs: 180000, limit: 65536 });
    } catch (error) {
      outputs.push({ latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "transport_error" });
      throw error;
    }
    const ps = await requestJson(host, "/api/ps", undefined, { signal, timeoutMs: 3000 });
    const allocation = ps.models?.find((m: { name: string }) => m.name === modelName);
    outputs.push({ latencyMs: Math.round(performance.now() - start), raw: response.message?.content, finishReason: response.done_reason,
      inputMessages: messages, allocation });
    if (ps.models?.length !== 1 || allocation?.size_vram !== 0 || allocation?.context_length !== DEFAULT_OPTIONS.num_ctx) throw new ModelError("internal_error");
    if (response.done !== true || response.done_reason !== "stop" || typeof response.message?.content !== "string") throw new ModelError("invalid_response");
    return response.message.content;
  } };
  const executor = new AgentExecutor(new WaveAgentTools(port));
  const conversation = new AgentConversation(model, executor);
  return { audio, engine, storage, conversation, executor, outputs };
}

const scenarios = [
  { id: "search-play-volume-ru", prompt: "Включи Northlight исполнителя Paper Moons и установи громкость 30%.", changes: ["wave_play", "wave_volume"],
    setup: async (_f: ReturnType<typeof fixture>) => {},
    verify: async (f: ReturnType<typeof fixture>) => f.audio.state === "playing" && f.engine.snapshot.current?.id === track.id && f.engine.snapshot.queue.length === 1 && f.audio.volume === .3 },
  { id: "queue-preserves-current-en", prompt: "Add Northlight by Paper Moons to the end of the queue. Keep the current song playing.", changes: ["wave_queue_add"],
    setup: async (f: ReturnType<typeof fixture>) => { await f.engine.playTracks([original]); },
    verify: async (f: ReturnType<typeof fixture>) => f.audio.state === "playing" && f.engine.snapshot.current?.id === original.id
      && f.engine.snapshot.queue.map((t) => t.id).join(",") === `${original.id},${track.id}` },
  { id: "create-populate-playlist-ru", prompt: "Создай плейлист «Для прогулки» и добавь в него Northlight исполнителя Paper Moons. Не включай музыку.", changes: ["wave_playlist_create", "wave_playlist_add"],
    setup: async (_f: ReturnType<typeof fixture>) => {},
    verify: async (f: ReturnType<typeof fixture>) => { const lists = await f.storage.getPlaylists(); return lists.length === 1 && lists[0].name === "Для прогулки"
      && lists[0].trackIds.join(",") === track.id && f.engine.snapshot.current === null && f.audio.state !== "playing"; } },
];

for (const scenario of scenarios) {
  it(scenario.id, async () => {
    const f = fixture();
    const start = performance.now();
    try {
      await scenario.setup(f);
      await f.conversation.send(scenario.prompt);
      const events = f.conversation.getSnapshot().events;
      const tools = events.filter((e) => e.type === "tool");
      const mutations = tools.filter((e) => AGENT_TOOLS[e.call.name].effect !== "read");
      const assertions = {
        finalStateCorrect: await scenario.verify(f),
        onlyRequestedChanges: mutations.every((e) => scenario.changes.includes(e.call.name)),
        eachChangeOnce: scenario.changes.every((name) => mutations.filter((e) => e.call.name === name).length === 1),
        noToolErrors: tools.every((e) => e.result.ok),
        finalAnswer: events[events.length - 1]?.type === "assistant",
        noControllerErrors: !events.some((e) => e.type === "error"),
      };
      const passed = Object.values(assertions).every(Boolean);
      rows.push({ id: scenario.id, prompt: scenario.prompt, assertions, passed, elapsedMs: Math.round(performance.now() - start),
        events, modelResponses: f.outputs, finalState: { state: f.engine.snapshot.state, queueTitles: f.engine.snapshot.queue.map((t) => t.title),
          volume: f.audio.volume, playlists: (await f.storage.getPlaylists()).map((p) => ({ name: p.name, titles: p.tracks?.map((t) => t.title) })) } });
      await writeFile(join(output, "scenarios.json"), JSON.stringify({ metadata, rows }, null, 2) + "\n");
      expect(passed, JSON.stringify(assertions)).toBe(true);
    } finally { f.conversation.dispose(); f.executor.dispose(); await f.executor.whenIdle(); f.engine.destroy(); }
  });
}
