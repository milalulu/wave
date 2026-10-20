import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "../core/util/EventEmitter";
import type { PlayerEngine } from "../core/player/PlayerEngine";
import type { AppServices } from "./compose";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./stores", () => ({ useApp: { getState: () => ({ notify: vi.fn(), pushLog: vi.fn() }) } }));
vi.mock("./compose", () => ({ searchAll: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bindPlugins } from "./plugins";

beforeEach(() => { vi.clearAllMocks(); });
function services() {
  const engine = new EventEmitter<{ track: unknown; state: string }>();
  Object.assign(engine, { snapshot: { queue: [], current: null } });
  return { engine: engine as unknown as PlayerEngine } as AppServices;
}

it("waits for all frontend listeners before loading Lua and removes engine subscriptions", async () => {
  const stops = Array.from({ length: 4 }, () => vi.fn());
  let resolveLast!: (stop: () => void) => void;
  const mocked = vi.mocked(listen);
  mocked.mockResolvedValueOnce(stops[0]).mockResolvedValueOnce(stops[1]).mockResolvedValueOnce(stops[2])
    .mockImplementationOnce(() => new Promise((resolve) => { resolveLast = resolve; }));
  const app = services();
  const cleanup = bindPlugins(app);
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalledWith("plugin_ready");
  resolveLast(stops[3]);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("plugin_ready"));
  cleanup();
  for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
  vi.mocked(invoke).mockClear();
  app.engine.emit("track", null);
  expect(invoke).not.toHaveBeenCalled();
});

it("cleans up late listener registrations without starting plugins after disposal", async () => {
  const pending: ((stop: () => void) => void)[] = [];
  vi.mocked(listen).mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
  const cleanup = bindPlugins(services());
  cleanup();
  const stop = vi.fn();
  pending.forEach((resolve) => resolve(stop));
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(4));
  expect(invoke).not.toHaveBeenCalledWith("plugin_ready");
});
