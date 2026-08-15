import { describe, expect, it, vi } from "vitest";
import type { Track } from "../types";
import { MockAudioAdapter } from "./PlayerAdapter";
import { PLAY_START_TIMEOUT_MS, PlayerEngine, STALL_TIMEOUT_MS } from "./PlayerEngine";

const tracks: Track[] = [
  { id: "a", provider: "test", uri: "u://a", title: "A" },
  { id: "b", provider: "test", uri: "u://b", title: "B" },
  { id: "c", provider: "test", uri: "u://c", title: "C" },
];

describe("PlayerEngine", () => {
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
    expect(adapter.src).toBe("https://www.youtube.com/watch?v=x");
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
    const orig = adapter.play;
    adapter.play = async () => {
      if (adapter.src.startsWith("https://www.youtube.com/")) {
        throw new Error("not supported");
      }
      return orig.call(adapter);
    };
    await engine.play();
    expect(adapter.src).toBe("u://fresh");
    expect(engine.snapshot.state).toBe("playing");
  });

  it("autoplays more tracks when queue ends", async () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const adapter = new MockAudioAdapter();
    const more = [tracks[1], tracks[2]];
    const engine = new PlayerEngine(adapter, {
      onQueueEnd: async () => more,
    });
    await engine.playTracks([tracks[0]]);
    adapter.end();
    await flush();
    expect(engine.snapshot.current?.id).toBe("b");
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
      expect(engine.snapshot.state).toBe("loading");
      engine.addToQueue(tracks[2], true);
      expect(engine.snapshot.current?.id).toBe("c");
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
});
