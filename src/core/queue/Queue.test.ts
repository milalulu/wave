import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { Queue } from "./Queue";

const tracks: Track[] = [
  { id: "a", provider: "test", uri: "u://a", title: "A" },
  { id: "b", provider: "test", uri: "u://b", title: "B" },
  { id: "c", provider: "test", uri: "u://c", title: "C" },
];

describe("Queue", () => {
  it("replaces and starts at given index", () => {
    const q = new Queue();
    q.replace(tracks, 1);
    expect(q.current()?.id).toBe("b");
    expect(q.currentIndex()).toBe(1);
    expect(q.length).toBe(3);
  });

  it("advances next() and rewinds previous()", () => {
    const q = new Queue();
    q.replace(tracks);
    expect(q.current()?.id).toBe("a");
    expect(q.next()?.id).toBe("b");
    expect(q.next()?.id).toBe("c");
    expect(q.next()).toBeNull();
    expect(q.previous()?.id).toBe("b");
  });

  it("previous() at start stays on first and seeks", () => {
    const q = new Queue();
    q.replace(tracks);
    expect(q.previous()).toBeNull();
    expect(q.current()?.id).toBe("a");
  });

  it("records history as it advances", () => {
    const q = new Queue();
    q.replace(tracks);
    q.next();
    q.next();
    expect(q.historyList.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("applies shuffle permutation deterministically", () => {
    const q = new Queue({ rng: () => 0 });
    q.replace(tracks);
    q.setShuffle(true);
    const seen: string[] = [];
    for (let p = 0; p < q.length; p++) {
      const t = q.jumpToOrderPos(p);
      if (t) seen.push(t.id);
    }
    expect(seen).toEqual(["b", "c", "a"]);
  });

  it("keeps current track after toggling shuffle", () => {
    const q = new Queue({ rng: () => 0 });
    q.replace(tracks);
    q.setShuffle(true);
    expect(q.current()?.id).toBe("a");
  });

  it("removes track at index and preserves others", () => {
    const q = new Queue();
    q.replace(tracks);
    q.removeAt(1);
    expect(q.tracksList.map((t) => t.id)).toEqual(["a", "c"]);
    expect(q.current()?.id).toBe("a");
  });

  it("keeps current track when removing a track before it", () => {
    const q = new Queue();
    q.replace(tracks, 1);
    expect(q.current()?.id).toBe("b");
    q.removeAt(0);
    expect(q.tracksList.map((t) => t.id)).toEqual(["b", "c"]);
    expect(q.current()?.id).toBe("b");
  });

  it("append in shuffle keeps order stable and inserts into tail", () => {
    const q = new Queue({ rng: () => 0 });
    q.replace(tracks);
    q.setShuffle(true);
    // order после replace+shuffle с rng=0: [b, c, a], pos=2 (текущий a)
    expect(q.current()?.id).toBe("a");
    q.append(tracks[0]);
    expect(q.current()?.id).toBe("a");
    // новый трек (idx 3) вставлен в несыгранный хвост (после pos=2)
    expect(q.positionOf(3)).toBeGreaterThanOrEqual(3);
  });

  it("clears", () => {
    const q = new Queue();
    q.replace(tracks);
    q.clear();
    expect(q.length).toBe(0);
    expect(q.current()).toBeNull();
  });

  it("moves a track to a new index keeping current position", () => {
    const q = new Queue();
    q.replace(tracks);
    q.move(2, 0);
    expect(q.tracksList.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(q.current()?.id).toBe("a");
    expect(q.currentIndex()).toBe(1);
  });

  it("moving current track keeps it current", () => {
    const q = new Queue();
    q.replace(tracks);
    q.move(0, 2);
    expect(q.tracksList.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(q.current()?.id).toBe("a");
  });

  it("ignores out-of-range moves", () => {
    const q = new Queue();
    q.replace(tracks);
    q.move(-1, 2);
    q.move(0, 9);
    expect(q.tracksList.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});
