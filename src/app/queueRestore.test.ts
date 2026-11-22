import { beforeEach, describe, expect, it } from "vitest";
import { loadRestore, saveRestore } from "./queueRestore";
import type { Track } from "../core/types";

const tracks = (length: number): Track[] => Array.from({ length }, (_, i) => ({
  id: `local:${i}`, provider: "local", title: `Track ${i}`, uri: `file:///music/${i}.mp3`,
}));

beforeEach(() => localStorage.clear());

describe("queue restore", () => {
  it("keeps the active track and position when limiting a long queue", () => {
    const queue = tracks(700);
    saveRestore(queue, 650, 42);
    const restored = loadRestore()!;
    expect(restored.queue).toHaveLength(300);
    expect(restored.queue[restored.index].id).toBe(queue[650].id);
    expect(restored.position).toBe(42);
  });

  it.each([
    { queue: [null], index: 0, position: 0 },
    { queue: [{}], index: 0, position: 0 },
    { queue: tracks(2), index: "bad", position: 0 },
    { queue: tracks(2), index: 0, position: -2 },
    { queue: tracks(2), index: 0.5, position: 0 },
    { queue: tracks(2), index: 4, position: 0 },
  ])("ignores invalid persisted data: %j", (data) => {
    localStorage.setItem("wave:queue-restore", JSON.stringify({ ...data, savedAt: Date.now() }));
    expect(loadRestore()).toBeNull();
  });

  it("round trips a small queue and rejects expired state", () => {
    const queue = tracks(3);
    saveRestore(queue, 1, 12);
    expect(loadRestore()).toMatchObject({ queue, index: 1, position: 12 });
    const state = loadRestore()!;
    localStorage.setItem("wave:queue-restore", JSON.stringify({ ...state, savedAt: 1 }));
    expect(loadRestore()).toBeNull();
  });
});

it("preserves each original artwork URL across a restart", () => {
  const queue = tracks(2).map((track, i) => ({ ...track, coverUrl: `https://example.test/album-${i}.jpg` }));
  saveRestore(queue, 0, 12);
  expect(loadRestore()?.queue).toEqual(queue);
});
