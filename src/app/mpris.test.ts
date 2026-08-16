// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.fn();
const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => {
    listenMock(...args);
    return Promise.resolve(() => {});
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { bindMpris } from "./mpris";
import type { AppServices } from "./compose";

function fakeEngine() {
  return {
    snapshot: {
      state: "playing",
      current: { id: "t1", provider: "test", uri: "u://t1", title: "T", artist: "A", album: "Al" },
      position: 10,
      duration: 200,
      volume: 0.5,
      shuffle: false,
      repeat: "off" as const,
    },
    on: vi.fn(),
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setShuffle: vi.fn(),
    setRepeat: vi.fn(),
  };
}

function setup() {
  const engine = fakeEngine();
  const services = { engine } as unknown as AppServices;
  bindMpris(services);
  const commandHandler = listenMock.mock.calls.find((c) => c[0] === "mpris-command")?.[1];
  if (!commandHandler) throw new Error("mpris-command listener not registered");
  const send = async (action: string, value?: unknown) => {
    await commandHandler({ payload: { action, value } });
  };
  const pushes = () =>
    invokeMock.mock.calls.filter((c) => c[0] === "mpris_update").length;
  return { engine, send, pushes };
}

describe("bindMpris", () => {
  beforeEach(() => {
    listenMock.mockClear();
    invokeMock.mockClear();
  });

  it("playpause toggles playback", async () => {
    const { engine, send } = setup();
    await send("playpause");
    expect(engine.togglePlay).toHaveBeenCalled();
  });

  it("seek applies a relative offset in microseconds as seconds", async () => {
    const { engine, send } = setup();
    await send("seek", 5_000_000);
    expect(engine.seek).toHaveBeenCalledWith(15);
    await send("seek", -3_000_000);
    expect(engine.seek).toHaveBeenCalledWith(7);
  });

  it("seek never goes below zero", async () => {
    const { engine, send } = setup();
    await send("seek", -99_000_000);
    expect(engine.seek).toHaveBeenCalledWith(0);
  });

  it("setPosition seeks to an absolute position in seconds", async () => {
    const { engine, send } = setup();
    await send("setPosition", 30_000_000);
    expect(engine.seek).toHaveBeenCalledWith(30);
  });

  it("setVolume clamps to the 0..1 range", async () => {
    const { engine, send } = setup();
    await send("setVolume", 0.42);
    expect(engine.setVolume).toHaveBeenCalledWith(0.42);
    await send("setVolume", 2);
    expect(engine.setVolume).toHaveBeenCalledWith(1);
    await send("setVolume", -1);
    expect(engine.setVolume).toHaveBeenCalledWith(0);
  });

  it("unknown actions are ignored", async () => {
    const { engine, send } = setup();
    await send("stop");
    expect(engine.togglePlay).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
  });

  it("throttles position pushes to once per second", async () => {
    const { engine, pushes } = setup();
    const time = engine.on.mock.calls.find((c) => c[0] === "time")?.[1];
    expect(time).toBeDefined();
    const before = pushes();
    time({ position: 11, duration: 200 });
    time({ position: 12, duration: 200 });
    time({ position: 13, duration: 200 });
    expect(pushes()).toBe(before);
    const state = engine.on.mock.calls.find((c) => c[0] === "state")?.[1];
    state("paused");
    expect(pushes()).toBe(before + 1);
  });
});
