import { describe, it, expect, vi } from "vitest";
import { OutputRouter } from "./OutputRouter";
import { MockAudioAdapter } from "./PlayerAdapter";

describe("output changes", () => {
  it("preserves playback position, volume and engine events", async () => {
    const local = new MockAudioAdapter(),
      remote = new MockAudioAdapter(),
      router = new OutputRouter(local);
    const ended = vi.fn();
    router.onEnded(ended);
    await router.load("song.mp3");
    router.setVolume(0.4);
    await router.play();
    local.tick(32);
    await router.switchTo(remote);
    expect(local.state).toBe("paused");
    expect(remote.src).toBe("song.mp3");
    expect(remote.position).toBe(32);
    expect(remote.volume).toBe(0.4);
    expect(remote.state).toBe("playing");
    local.end();
    expect(ended).not.toHaveBeenCalled();
    remote.end();
    expect(ended).toHaveBeenCalledOnce();
  });
  it("keeps local playback when the receiver rejects a load", async () => {
    const local = new MockAudioAdapter(),
      remote = new MockAudioAdapter(),
      router = new OutputRouter(local);
    remote.load = vi.fn().mockRejectedValue(new Error("unsupported media"));
    await router.load("song");
    await router.play();
    await expect(router.switchTo(remote)).rejects.toThrow("unsupported media");
    expect(local.state).toBe("playing");
  });
  it("restores the previous output if starting remote playback fails", async () => {
    const local = new MockAudioAdapter(),
      remote = new MockAudioAdapter(),
      router = new OutputRouter(local);
    remote.play = vi.fn().mockRejectedValue(new Error("connection lost"));
    await router.load("song");
    await router.play();
    await expect(router.switchTo(remote)).rejects.toThrow();
    expect(local.state).toBe("playing");
    expect(remote.state).toBe("idle");
  });
  it("disconnect returns locally paused and serializes a concurrent new track", async () => {
    const local = new MockAudioAdapter(),
      remote = new MockAudioAdapter(),
      router = new OutputRouter(local);
    await router.load("one");
    await router.play();
    await router.switchTo(remote);
    remote.tick(21);
    await Promise.all([router.switchTo(local, false), router.load("two")]);
    expect(local.state).toBe("paused");
    expect(local.src).toBe("two");
    expect(remote.state).toBe("idle");
  });
});
