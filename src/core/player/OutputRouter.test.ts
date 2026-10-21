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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("transfers the position reached during a slow receiver load", async () => {
  const local = new MockAudioAdapter(), remote = new MockAudioAdapter();
  const router = new OutputRouter(local), loading = deferred();
  await router.load("song");
  await router.play();
  local.tick(20);
  remote.load = vi.fn(async () => { await loading.promise; });
  const handoff = router.switchTo(remote);
  await vi.waitFor(() => expect(remote.load).toHaveBeenCalled());
  local.tick(27);
  loading.resolve();
  await handoff;
  expect(remote.position).toBe(27);
  router.destroy();
});

it("refreshes the loaded source on every handoff and preserves playback if policy rejects it", async () => {
  const local = new MockAudioAdapter(), remote = new MockAudioAdapter();
  const router = new OutputRouter(local);
  const refresh = vi.fn().mockResolvedValueOnce("fresh").mockRejectedValueOnce(new Error("offline"));
  await router.load("expired", refresh);
  await router.play();
  await router.switchTo(remote);
  expect(remote.src).toBe("fresh");
  await expect(router.switchTo(local)).rejects.toThrow("offline");
  expect(remote.state).toBe("playing");
  router.destroy();
});

it("destruction cancels an active handoff and queued loads/play without resurrecting outputs", async () => {
  const local = new MockAudioAdapter(), remote = new MockAudioAdapter();
  const router = new OutputRouter(local), loading = deferred();
  await router.load("one");
  await router.play();
  remote.load = vi.fn(() => loading.promise);
  remote.play = vi.fn();
  const localLoad = vi.spyOn(local, "load"), destroy = vi.spyOn(remote, "destroy");
  const handoff = router.switchTo(remote);
  const pending = Promise.allSettled([handoff, router.load("two"), router.play()]);
  await vi.waitFor(() => expect(remote.load).toHaveBeenCalled());
  router.destroy();
  router.destroy();
  loading.resolve();
  expect((await pending).map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
  expect(remote.play).not.toHaveBeenCalled();
  expect(localLoad).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
  expect(local.state).toBe("idle");
});

it("does not restore playback when destroyed while remote play is pending", async () => {
  const local = new MockAudioAdapter(), remote = new MockAudioAdapter();
  const router = new OutputRouter(local), playing = deferred();
  await router.load("one");
  await router.play();
  remote.play = vi.fn(() => playing.promise);
  const localPlay = vi.spyOn(local, "play");
  const handoff = router.switchTo(remote);
  const result = expect(handoff).rejects.toThrow("destroyed");
  await vi.waitFor(() => expect(remote.play).toHaveBeenCalled());
  router.destroy();
  playing.resolve();
  await result;
  expect(localPlay).not.toHaveBeenCalled();
});

it("pause takes effect during receiver loading and prevents automatic resume", async () => {
  const local = new MockAudioAdapter(), remote = new MockAudioAdapter();
  const router = new OutputRouter(local), loading = deferred();
  await router.load("one");
  await router.play();
  remote.load = vi.fn(() => loading.promise);
  remote.play = vi.fn();
  const handoff = router.switchTo(remote);
  await vi.waitFor(() => expect(remote.load).toHaveBeenCalled());
  router.pause();
  expect(local.state).toBe("paused");
  loading.resolve();
  await handoff;
  expect(remote.play).not.toHaveBeenCalled();
  router.destroy();
});
