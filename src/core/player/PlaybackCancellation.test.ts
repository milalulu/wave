import { expect, it } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { MockAudioAdapter } from "./PlayerAdapter";
import type { Track } from "../types";
const a: Track = { id: "a", title: "A", provider: "local", uri: "asset:///a" };
const b: Track = { ...a, id: "b", uri: "asset:///b" };

it.each(["pause", "replace"])("late queue continuation respects %s", async (action) => {
  const adapter = new MockAudioAdapter();
  const engine = new PlayerEngine(adapter);
  await engine.playTracks([a]);
  let finish!: (tracks: Track[]) => void;
  engine.setAutoFill(() => new Promise((resolve) => { finish = resolve; }));
  const next = engine.next();
  if (action === "pause") engine.pause();
  else {
    engine.setAutoFill(async () => []);
    await engine.playTracks([b]);
  }
  finish([a]); await next;
  if (action === "pause") expect(adapter.state).toBe("paused");
  else expect(engine.snapshot.current?.id).toBe("b");
  engine.destroy();
});
