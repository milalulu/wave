import { describe, expect, it, vi } from "vitest";
import type { PlayerState, Track } from "../types";
import { MockAudioAdapter } from "./PlayerAdapter";
import { PLAY_START_TIMEOUT_MS, PlayerEngine, STALL_TIMEOUT_MS } from "./PlayerEngine";
import { normalizeEqualizer } from "./equalizerPresets";

const tracks: Track[] = [
  { id: "a", provider: "test", uri: "u://a", title: "A" },
  { id: "b", provider: "test", uri: "u://b", title: "B" },
  { id: "c", provider: "test", uri: "u://c", title: "C" },
];

describe("PlayerEngine", () => {
  it("resumes at the saved position in album order and stops without recommendations", async () => {
    const adapter = new MockAudioAdapter();
    const crossfade = vi.spyOn(adapter, "setCrossfadeMs");
    const fill = vi.fn(() => tracks);
    const engine = new PlayerEngine(adapter, { crossfadeMs: 900, onQueueEnd: fill });
    try {
      engine.setShuffle(true);
      await engine.playTracks(tracks, 1, "album", 17);
      expect(engine.snapshot).toMatchObject({ mode: "album", shuffle: false, queueIndex: 1, position: 17 });
      expect(crossfade).toHaveBeenLastCalledWith(0);
      adapter.end();
      await vi.waitFor(() => expect(engine.snapshot).toMatchObject({ state: "playing", queueIndex: 2 }));
      adapter.end();
      await vi.waitFor(() => expect(engine.snapshot.state).toBe("ended"));
      expect(engine.snapshot.queue).toEqual(tracks);
      expect(fill).not.toHaveBeenCalled();
      await engine.playTracks([tracks[0]]);
      expect(engine.snapshot.mode).toBe("normal");
      expect(crossfade).toHaveBeenLastCalledWith(900);
    } finally { engine.destroy(); }
  });

  it("recovers the same song from a second provider at the interrupted position", async () => {
    const adapter = new MockAudioAdapter();
    const original = { ...tracks[0], provider: "youtube" };
    const alternate = { ...original, playbackSource: { ...original, id: "sc:a", provider: "soundcloud", uri: "u://sc" } };
    const recovery = vi.fn(async () => alternate);
    const engine = new PlayerEngine(adapter, { retries: 0, resolveUri: async (track) => track.playbackSource?.uri ?? track.uri,
      recoverSource: recovery });
    try {
      await engine.playTracks([original, tracks[1]], 0, "normal", 44);
      adapter.fail("network error");
      await vi.waitFor(() => expect(engine.snapshot).toMatchObject({ current: alternate, state: "playing", position: 44 }));
      expect(recovery).toHaveBeenCalledTimes(1);
      expect(engine.snapshot.queueIndex).toBe(0);
    } finally { engine.destroy(); }
  });

  it("keeps measured album gain constant across tracks and obeys the effects bypass", async () => {
    const gain = vi.fn();
    const adapter = Object.assign(new MockAudioAdapter(), { setMeasuredGain: gain });
    const measureLoudness = vi.fn(async () => -20);
    const engine = new PlayerEngine(adapter, { measureLoudness });
    try {
      engine.setLeveling(true, -14, "album");
      await engine.playTracks(tracks, 0, "album");
      await vi.waitFor(() => expect(gain).toHaveBeenLastCalledWith(10 ** (6 / 20)));
      await engine.next();
      expect(gain).toHaveBeenLastCalledWith(10 ** (6 / 20));
      expect(measureLoudness).toHaveBeenCalledTimes(1);
      engine.setEffectsBypassed(true);
      expect(gain).toHaveBeenLastCalledWith(1);
      engine.setEffectsBypassed(false);
      expect(gain).toHaveBeenLastCalledWith(10 ** (6 / 20));
    } finally { engine.destroy(); }
  });

  it("keeps effects bypassed across track changes and restores edits made in A mode", async () => {
    const adapter = new MockAudioAdapter();
    const eq = vi.spyOn(adapter, "setEqualizer");
    const bass = vi.spyOn(adapter, "setBassBoost");
    const reverb = vi.spyOn(adapter, "setReverb");
    const stereo = vi.spyOn(adapter, "setStereoWidth");
    const leveling = vi.spyOn(adapter, "setLeveling");
    const orbit = vi.spyOn(adapter, "setSpatialOrbit");
    const engine = new PlayerEngine(adapter);
    engine.setEqualizer([3]);
    engine.setBassBoost(6);
    engine.setReverb(0.2);
    engine.setStereoWidth(0.3);
    engine.setLeveling(true, -16);
    engine.setSpatialOrbit(0.45);
    engine.setEffectsBypassed(true);
    engine.setEqualizer([4]);
    await engine.playTrack(tracks[0]);
    expect(eq).toHaveBeenLastCalledWith([]);
    expect(bass).toHaveBeenLastCalledWith(0);
    expect(reverb).toHaveBeenLastCalledWith(0);
    expect(stereo).toHaveBeenLastCalledWith(0);
    expect(leveling).toHaveBeenLastCalledWith(false, -16);
    expect(orbit).toHaveBeenLastCalledWith(0);
    expect(engine.snapshot.equalizer).toEqual(normalizeEqualizer([4]));
    engine.setEffectsBypassed(false);
    expect(eq).toHaveBeenLastCalledWith(normalizeEqualizer([4]));
    expect(bass).toHaveBeenLastCalledWith(6);
    expect(reverb).toHaveBeenLastCalledWith(0.2);
    expect(stereo).toHaveBeenLastCalledWith(0.3);
    expect(leveling).toHaveBeenLastCalledWith(true, -16);
    expect(orbit).toHaveBeenLastCalledWith(0.45);
    engine.destroy();
  });

  it("stops after five consecutive failed tracks instead of exhausting the queue", async () => {
    const adapter = new MockAudioAdapter();
    const resolve = vi.fn(async (track: Track) => { if (track.id === "0") return track.uri; throw new Error("dead stream"); });
    const engine = new PlayerEngine(adapter, { retries: 0, resolveUri: resolve });
    const errors: string[] = [];
    engine.on("error", (message) => errors.push(message));
    await engine.playTracks(Array.from({ length: 20 }, (_, i) => ({ ...tracks[0], id: String(i) })));
    adapter.end();
    await vi.waitFor(() => expect(errors).toContain("too many failed tracks in a row, stopping"));
    // Resolver also receives speculative preloads; only four failures may
    // advance the queue before the fifth stops playback.
    expect(errors.filter((message) => message === "dead stream")).toHaveLength(4);
    expect(resolve.mock.calls.length).toBeLessThan(20);
    engine.destroy();
  });
  it("records one successful play across pause, resume and source replacement", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    const played = vi.fn();
    engine.on("played", played);
    await engine.playTrack(tracks[0]);
    engine.pause();
    await engine.play();
    engine.playVariant({ ...tracks[0], uri: "u://replacement" }, true);
    await vi.waitFor(() => expect(adapter.src).toBe("u://replacement"));
    expect(played).toHaveBeenCalledTimes(1);
    await engine.playTrack(tracks[0]);
    expect(played).toHaveBeenCalledTimes(2);
    engine.destroy();
  });

  it("counts repeat-one as a new play", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    const played = vi.fn();
    engine.on("played", played);
    await engine.playTrack(tracks[0]);
    engine.setRepeat("one");
    adapter.end();
    await vi.waitFor(() => expect(played).toHaveBeenCalledTimes(2));
    engine.destroy();
  });

  it("does not record a failed play even if the adapter first announces playing", async () => {
    const adapter = new MockAudioAdapter();
    const original = adapter.play.bind(adapter);
    vi.spyOn(adapter, "play").mockImplementation(async () => { await original(); throw new Error("decode failed"); });
    const engine = new PlayerEngine(adapter, { retries: 0 });
    const played = vi.fn();
    engine.on("played", played);
    await engine.playTrack(tracks[0]);
    expect(played).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("plays first track of a list", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    const snap = engine.snapshot;
    expect(snap.current?.id).toBe("a");
    expect(snap.state).toBe("playing");
    expect(snap.queue.length).toBe(3);
  });

  it("advances on ended", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    adapter.end();
    expect(engine.snapshot.current?.id).toBe("b");
  });

  it("updateTrack refreshes the current and queued track metadata", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks([{ ...tracks[0] }, { ...tracks[0] }, tracks[1]]);
    engine.updateTrack("a", { title: "A*", artist: "X" });
    expect(engine.snapshot.current?.title).toBe("A*");
    expect(engine.snapshot.current?.artist).toBe("X");
    const sameId = engine.snapshot.queue.filter((t) => t.id === "a");
    expect(sameId).toHaveLength(2);
    for (const t of sameId) {
      expect(t.title).toBe("A*");
    }
  });

  it("stops at end of queue with repeat off", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    adapter.end();
    adapter.end();
    adapter.end();
    expect(engine.snapshot.current).toBeNull();
    expect(engine.snapshot.queue).toEqual([]);
  });

  it("wraps around with repeat all", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.setRepeat("all");
    adapter.end();
    adapter.end();
    adapter.end();
    expect(engine.snapshot.current?.id).toBe("a");
  });

  it("repeats single track with repeat one", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.setRepeat("one");
    adapter.end();
    expect(engine.snapshot.current?.id).toBe("a");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("pauses after current track when pause-after-track is armed", async () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.setPauseAfterTrack(true);
    adapter.end();
    await flush();
    
    expect(engine.snapshot.current?.id).toBe("a");
    expect(engine.snapshot.state).toBe("paused");
    adapter.end();
    await flush();
    expect(engine.snapshot.current?.id).toBe("b");
    engine.destroy();
  });

  it("pauses and resumes", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.pause();
    expect(engine.snapshot.state).toBe("paused");
    await engine.play();
    expect(engine.snapshot.state).toBe("playing");
  });

  it("seek and volume are applied", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.seek(42);
    engine.setVolume(0.33);
    const snap = engine.snapshot;
    expect(snap.position).toBe(42);
    expect(snap.volume).toBe(0.33);
    expect(adapter.getPosition()).toBe(42);
    expect(adapter.volume).toBe(0.33);
  });

  it("volume is clamped to 0..1", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.setVolume(5);
    expect(engine.snapshot.volume).toBe(1);
    engine.setVolume(-3);
    expect(engine.snapshot.volume).toBe(0);
  });

  it("adds to queue and plays on demand", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks([tracks[0]]);
    engine.addToQueue(tracks[1]);
    expect(engine.snapshot.queue).toHaveLength(2);
    engine.addToQueue(tracks[2], true);
    expect(engine.snapshot.current?.id).toBe("c");
  });

  it("emits time events", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    const times: number[] = [];
    engine.on("time", ({ position }) => times.push(position));
    adapter.tick(15);
    adapter.tick(30);
    expect(times).toEqual([15, 30]);
    engine.destroy();
  });

  it("clears queue", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks(tracks);
    engine.clearQueue();
    expect(engine.snapshot.current).toBeNull();
    expect(engine.snapshot.queue).toEqual([]);
    expect(engine.snapshot.state).toBe("idle");
  });

  it("emits track event on restoreQueue", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    const seen: (string | null)[] = [];
    engine.on("track", (t) => seen.push(t?.id ?? null));
    await engine.restoreQueue([tracks[0]], 0);
    expect(seen).toEqual(["a"]);
  });

  it("track event state differs: paused on restore, loading on real play", async () => {
    
    
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    const states: PlayerState[] = [];
    engine.on("track", () => states.push(engine.snapshot.state));
    await engine.restoreQueue([tracks[0]], 0);
    await engine.playTracks([tracks[1]]);
    expect(states).toEqual(["paused", "loading"]);
  });

  it("resolves uri on first play after restore when no source was preloaded", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => "u://resolved",
    });
    await engine.restoreQueue([tracks[0]], 0, 10);
    expect(engine.snapshot.state).toBe("paused");
    await engine.play();
    expect(adapter.src).toBe("u://resolved");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("does not auto-play or retry on load error while paused (restore)", async () => {
    const adapter = new MockAudioAdapter();
    const resolved: string[] = [];
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        resolved.push(t.id);
        return "u://fresh";
      },
    });
    await engine.restoreQueue(
      [{ ...tracks[0], uri: "https://www.youtube.com/watch?v=x" }],
      0,
    );
    adapter.fail("audio error code 4");
    expect(resolved).toEqual([]);
    expect(engine.snapshot.state).toBe("paused");
    expect(adapter.src).toBe("");
    engine.destroy();
  });

  it("does not load a youtube page into the adapter on restore", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.restoreQueue(
      [{ ...tracks[0], uri: "https://www.youtube.com/watch?v=x" }],
      0,
      30,
    );
    
    expect(adapter.src).toBe("");
    
    expect(adapter.getPosition()).toBe(30);
    engine.destroy();
  });

  it("re-resolves stale uri when play fails after restore", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => "u://fresh",
    });
    await engine.restoreQueue(
      [{ ...tracks[0], uri: "https://www.youtube.com/watch?v=x" }],
      0,
    );
    await engine.play();
    expect(adapter.src).toBe("u://fresh");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("applies restored position after first play of a track without direct uri", async () => {
    
    
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => "u://resolved",
    });
    await engine.restoreQueue(
      [{ ...tracks[0], uri: "https://www.youtube.com/watch?v=x" }],
      0,
      42,
    );
    expect(adapter.src).toBe("");
    expect(adapter.getPosition()).toBe(42);
    await engine.play();
    expect(adapter.src).toBe("u://resolved");
    expect(adapter.getPosition()).toBe(42);
    expect(engine.snapshot.state).toBe("playing");
    engine.destroy();
  });

  it("does not apply restored position to a new queue", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => "u://resolved",
    });
    await engine.restoreQueue(
      [{ ...tracks[0], uri: "https://www.youtube.com/watch?v=x" }],
      0,
      42,
    );
    await engine.playTracks([tracks[1]]);
    expect(adapter.getPosition()).toBe(0);
    engine.destroy();
  });

  it("autoplays more tracks when queue ends", async () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const adapter = new MockAudioAdapter();
    const [start, next, last] = tracks.map((track) => ({ ...track, artist: "Example Artist" }));
    const more = [
      { ...start, id: "reupload", title: `${start.title} (Sped Up)` },
      next, { ...next, id: "version", title: `${next.title} (Remix)` }, last,
    ];
    const engine = new PlayerEngine(adapter, {
      onQueueEnd: async () => more,
    });
    await engine.playTracks([start]);
    adapter.end();
    await flush();
    expect(engine.snapshot.current?.id).toBe("b");
    expect(engine.snapshot.queue.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    adapter.end();
    await flush();
    expect(engine.snapshot.current?.id).toBe("c");
  });

  it("stops when autoplay returns empty", async () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      onQueueEnd: async () => [],
    });
    await engine.playTracks([tracks[0]]);
    adapter.end();
    await flush();
    expect(engine.snapshot.current).toBeNull();
    expect(engine.snapshot.queue).toEqual([]);
  });
});

describe("PlayerEngine resolveUri", () => {
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it("resolves uri lazily before playing", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => "u://resolved",
    });
    await engine.playTracks([tracks[0]]);
    expect(adapter.src).toBe("u://resolved");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("resolves only the current track before play, then the next", async () => {
    const adapter = new MockAudioAdapter();
    const ids: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        ids.push(t.id);
        if (t.id === "a") await gate;
        return t.uri;
      },
    });
    const started = engine.playTracks(tracks);
    await flush();
    expect(ids).toEqual(["a"]);
    release();
    await started;
    await flush();
    expect(ids).toEqual(["a", "b"]);
    engine.destroy();
  });

  it("uses track.uri directly when no resolver", async () => {
    const adapter = new MockAudioAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.playTracks([tracks[0]]);
    expect(adapter.src).toBe("u://a");
  });

  it("retries once when resolve fails then succeeds", async () => {
    const adapter = new MockAudioAdapter();
    let attempts = 0;
    const errors: string[] = [];
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("stream expired");
        return "u://fresh";
      },
    });
    engine.on("error", (m) => errors.push(m));
    await engine.playTracks([tracks[0]]);
    await flush();
    expect(errors).toEqual([]);
    expect(attempts).toBe(2);
    expect(adapter.src).toBe("u://fresh");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("emits error after exhausting retries", async () => {
    const adapter = new MockAudioAdapter();
    const errors: string[] = [];
    const engine = new PlayerEngine(adapter, {
      resolveUri: async () => {
        throw new Error("dead");
      },
    });
    engine.on("error", (m) => errors.push(m));
    await engine.playTracks([tracks[0]]);
    await flush();
    await flush();
    expect(errors).toEqual(["dead"]);
  });

  it("re-resolves once on adapter load error", async () => {
    const adapter = new MockAudioAdapter();
    const resolved: string[] = [];
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        resolved.push(t.id);
        return `u://${t.id}:${resolved.length}`;
      },
    });
    await engine.playTracks([tracks[0]]);
    expect(resolved).toEqual(["a"]);
    adapter.fail("audio error code 4");
    await flush();
    expect(resolved).toEqual(["a", "a"]);
    expect(adapter.src).toBe("u://a:2");
    adapter.fail("audio error code 4");
    await flush();
    const errors: string[] = [];
    engine.on("error", (m) => errors.push(m));
    expect(errors).toEqual([]);
  });

  it("re-resolves and resumes when stream stalls in loading", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MockAudioAdapter();
      const resolved: string[] = [];
      const engine = new PlayerEngine(adapter, {
        resolveUri: async (t) => {
          resolved.push(t.id);
          return `u://${t.id}:${resolved.length}`;
        },
      });
      await engine.playTracks([tracks[0]]);
      expect(resolved).toEqual(["a"]);
      adapter.setState("loading");
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1);
      expect(resolved).toEqual(["a", "a"]);
      expect(adapter.src).toBe("u://a:2");
      expect(engine.snapshot.state).toBe("playing");
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits error when stall cannot be re-resolved", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MockAudioAdapter();
      const errors: string[] = [];
      const engine = new PlayerEngine(adapter);
      engine.on("error", (m) => errors.push(m));
      await engine.playTracks([tracks[0]]);
      adapter.setState("loading");
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1);
      expect(errors).toEqual(["stream stalled"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores stale async resolution after next()", async () => {
    const adapter = new MockAudioAdapter();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        calls += 1;
        if (calls === 1) await gate;
        return `u://${t.id}:${calls}`;
      },
    });
    const p1 = engine.playTracks([tracks[0], tracks[1]]);
    const p2 = engine.next();
    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(2);
    expect(adapter.src).toBe("u://b:2");
    expect(engine.snapshot.current?.id).toBe("b");
  });

  it("skips a track that cannot be loaded", async () => {
    const adapter = new MockAudioAdapter();
    const errors: string[] = [];
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        if (t.id === "b") throw new Error("dead url");
        return t.uri;
      },
    });
    engine.on("error", (m) => errors.push(m));
    await engine.playTracks(tracks);
    adapter.end();
    await flush();
    await flush();
    expect(errors).toEqual(["dead url"]);
    expect(engine.snapshot.current?.id).toBe("c");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("does not deadlock when play() never resolves", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MockAudioAdapter();
      adapter.play = async () => new Promise<void>(() => {});
      const engine = new PlayerEngine(adapter);
      const started = engine.playTracks(tracks);
      await vi.advanceTimersByTimeAsync(PLAY_START_TIMEOUT_MS + 1);
      await started;
      expect(engine.snapshot.state).toBe("paused");
      engine.addToQueue({ id: "d", provider: "test", uri: "u://d", title: "D" }, true);
      expect(engine.snapshot.current?.id).toBe("d");
      expect(engine.snapshot.queue).toHaveLength(4);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-resolves on play() rejection and keeps playing", async () => {
    const adapter = new MockAudioAdapter();
    let attempts = 0;
    const engine = new PlayerEngine(adapter, {
      resolveUri: async (t) => {
        attempts += 1;
        return `u://${t.id}:${attempts}`;
      },
    });
    adapter.play = async () => {
      if (attempts === 1) throw new Error("autoplay blocked");
    };
    await engine.playTracks([tracks[0]]);
    expect(attempts).toBeGreaterThan(1);
    expect(engine.snapshot.current?.id).toBe("a");
  });

  it("upgrades a short preview stream to a full variant", async () => {
    const adapter = new MockAudioAdapter();
    const full = { id: "youtube:1", provider: "youtube", uri: "u://full", title: "A", duration: 200 };
    const upgrade = vi.fn().mockResolvedValue(full);
    const engine = new PlayerEngine(adapter, { upgradePreview: upgrade });
    const preview: Track = {
      id: "itunes:1",
      provider: "itunes",
      uri: "u://preview",
      title: "A",
      duration: 200,
    };
    await engine.playTracks([preview, tracks[1]]);
    adapter.duration = 30;
    adapter.tick(1);
    await vi.waitFor(() => expect(engine.snapshot.current?.id).toBe("youtube:1"));
    expect(upgrade).toHaveBeenCalledWith(preview);
    expect(engine.snapshot.state).toBe("playing");
  });

  it("keeps the preview when no full variant is found and does not retry", async () => {
    const adapter = new MockAudioAdapter();
    const upgrade = vi.fn().mockResolvedValue(null);
    const engine = new PlayerEngine(adapter, { upgradePreview: upgrade });
    const preview: Track = {
      id: "deezer:1",
      provider: "deezer",
      uri: "u://preview",
      title: "B",
      duration: 180,
    };
    await engine.playTracks([preview]);
    adapter.duration = 30;
    adapter.tick(1);
    await vi.waitFor(() => expect(upgrade).toHaveBeenCalledTimes(1));
    expect(engine.snapshot.current?.id).toBe("deezer:1");
    adapter.tick(5);
    await Promise.resolve();
    expect(upgrade).toHaveBeenCalledTimes(1);
  });

  it("does not upgrade a full-length stream", async () => {
    const adapter = new MockAudioAdapter();
    const upgrade = vi.fn();
    const engine = new PlayerEngine(adapter, { upgradePreview: upgrade });
    const t: Track = {
      id: "local:1",
      provider: "local",
      uri: "file:///x.mp3",
      title: "X",
      duration: 200,
    };
    await engine.playTracks([t]);
    adapter.duration = 200;
    adapter.tick(1);
    await Promise.resolve();
    expect(upgrade).not.toHaveBeenCalled();
  });
});
