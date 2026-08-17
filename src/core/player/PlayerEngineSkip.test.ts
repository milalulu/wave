// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CROSSFADE_MS, WebAudioAdapter } from "./WebAudioAdapter";
import { PlayerEngine } from "./PlayerEngine";
import type { Track } from "../types";

class FakeParam {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
}
class FakeGain {
  gain = new FakeParam(1);
  connect(): void {}
}
class FakeAnalyser {
  fftSize = 256;
  connect(): void {}
  getByteFrequencyData(data: Uint8Array): void {
    data.fill(42);
  }
}
class FakeConvolver {
  buffer: unknown = null;
  connect(): void {}
}
class FakeStereoPanner {
  pan = new FakeParam(0);
  connect(): void {}
}
class FakeDecodedBuffer {
  duration = 120;
  private channels: Float32Array[] = [new Float32Array(0), new Float32Array(0)];
  getChannelData(ch: number): Float32Array {
    return this.channels[ch] ?? new Float32Array(0);
  }
}
class FakeBiquad {
  type = "";
  frequency = { value: 0 };
  Q = { value: 0 };
  gain = new FakeParam(0);
  connect(): void {}
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = "suspended";
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  elementSources: unknown[] = [];
  gains: FakeGain[] = [];
  biquads: FakeBiquad[] = [];
  analyser!: FakeAnalyser;
  resumeCount = 0;
  closed = false;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaElementSource(el: { paused: boolean }): { connect: () => void } {
    this.elementSources.push(el);
    return { connect: () => undefined };
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeBiquad {
    const f = new FakeBiquad();
    this.biquads.push(f);
    return f;
  }
  createAnalyser(): FakeAnalyser {
    this.analyser = new FakeAnalyser();
    return this.analyser;
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver();
  }
  createStereoPanner(): FakeStereoPanner {
    return new FakeStereoPanner();
  }
  createBuffer(): FakeDecodedBuffer {
    return new FakeDecodedBuffer();
  }
  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
class FakeAudioElement {
  static instances: FakeAudioElement[] = [];
  src = "";
  currentSrc = "";
  currentTime = 0;
  duration = 100;
  volume = 1;
  playbackRate = 1;
  preload = "none";
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  ondurationchange: (() => void) | null = null;
  playCalls = 0;
  loadCount = 0;
  hangPlay = false;
  constructor() {
    FakeAudioElement.instances.push(this);
  }
  load(): void {
    this.loadCount += 1;
    this.currentSrc = this.src;
  }
  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.ended = false;
    this.onplay?.();
    if (this.hangPlay) return new Promise<void>(() => undefined);
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.onpause?.();
  }
  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.currentSrc = "";
    }
  }
}
function instances(): FakeAudioElement[] {
  return FakeAudioElement.instances;
}

const mk = (n: string, provider = "a"): Track => ({
  id: n,
  title: n,
  provider,
  uri: `${provider}://${n}`,
});

describe("PlayerEngine + WebAudioAdapter: skip на зависший стрим", () => {
  let adapter: WebAudioAdapter;
  let engine: PlayerEngine;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioElement.instances = [];
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: FakeAudioContext,
    } as unknown as Window;
    globalThis.AudioContext = FakeAudioContext as never;
    globalThis.Audio = FakeAudioElement as never;
    adapter = new WebAudioAdapter(0);
    engine = new PlayerEngine(adapter, { resolveUri: (t) => Promise.resolve(t.uri) });
  });

  afterEach(() => {
    engine.destroy();
    vi.clearAllTimers();
  });

  it("старый трек гасится, даже если play() нового не завершается", async () => {
    vi.useFakeTimers();
    await engine.playTracks([mk("A"), mk("B")], 0);
    expect(instances()[0].paused).toBe(false);

    instances()[1].hangPlay = true;

    const skipP = engine.next();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CROSSFADE_MS + 100);
    expect(instances()[0].paused).toBe(true);
    expect(instances()[1].paused).toBe(false);

    await vi.advanceTimersByTimeAsync(12000);
    await skipP;
    adapter.destroy();
  });
});
