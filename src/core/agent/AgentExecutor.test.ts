import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExecutor, type AgentToolHandler } from "./AgentExecutor";
import type { ToolName } from "./contract";

const call = { type: "tool", name: "wave_playlist_create", args: { name: "Focus" } };
const allowedTools: ToolName[] = ["wave_playlist_create", "wave_volume"];
afterEach(() => vi.useRealTimers());

describe("agent request lifecycle", () => {
  it("retains the execution lock after timeout and resolves uncertain writes without replaying them", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let writes = 0;
    let volume = 100;
    const handler: AgentToolHandler = {
      clear: () => {},
      run: async (tool, scope) => {
        scope.commit();
        if (tool.name === "wave_volume") volume = tool.args.percent;
        else {
          writes++;
          await new Promise<void>((resolve) => { finish = resolve; });
        }
        return { ok: true, data: { id: "new", name: "Focus", trackCount: 0 } };
      },
    };
    const executor = new AgentExecutor(handler, { timeoutMs: 50 });
    const first = executor.execute("write", call, { allowedTools });
    await vi.advanceTimersByTimeAsync(51);
    expect(await first).toMatchObject({ ok: false, error: { code: "timeout", effect: "unknown" } });
    expect(executor.result("write")).toBeNull();
    const queued = executor.execute("volume", { type: "tool", name: "wave_volume", args: { percent: 20 } }, { allowedTools });
    await Promise.resolve(); expect(volume).toBe(100);
    finish(); await queued;
    expect(volume).toBe(20);
    expect(executor.result("write")).toMatchObject({ ok: true });
    expect(await executor.execute("write", call, { allowedTools })).toMatchObject({ ok: true });
    expect(writes).toBe(1);
    executor.dispose();
  });

  it("does not execute cancelled queued requests and copies arguments before enqueueing", async () => {
    let finish!: () => void;
    const names: string[] = [];
    const handler: AgentToolHandler = {
      clear: () => {}, run: async (tool, scope) => {
        scope.check();
        if (tool.name === "wave_playlist_create") names.push(tool.args.name);
        if (names.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
        return { ok: true, data: { id: "x", name: "x", trackCount: 0 } };
      },
    };
    const executor = new AgentExecutor(handler);
    const first = executor.execute("first", call, { allowedTools });
    await Promise.resolve();
    const controller = new AbortController();
    const cancelled = executor.execute("cancelled", call, { allowedTools, signal: controller.signal });
    controller.abort(); expect(await cancelled).toMatchObject({ ok: false, error: { effect: "not_started" } });
    const mutable = { ...call, args: { name: "Original" } };
    const last = executor.execute("last", mutable, { allowedTools });
    mutable.args.name = "Tampered";
    finish(); await first; await last;
    expect(names).toEqual(["Focus", "Original"]);
    executor.dispose();
  });

  it("rejects new requests at the session bound without evicting completed IDs", async () => {
    const run = vi.fn<AgentToolHandler["run"]>().mockResolvedValue({ ok: true, data: { id: "x", name: "Focus", trackCount: 0 } });
    const executor = new AgentExecutor({ run, clear: () => {} }, { maxRequests: 1 });
    const result = await executor.execute("one", call, { allowedTools });
    if (result.ok && "name" in result.data) result.data.name = "Tampered";
    expect(await executor.execute("two", call, { allowedTools })).toMatchObject({ ok: false, error: { code: "session_limit" } });
    expect(await executor.execute("one", call, { allowedTools })).toMatchObject({ ok: true, data: { name: "Focus" } });
    expect(run).toHaveBeenCalledOnce();
    executor.dispose();
  });

  it("sanitizes internal failures and never calls handlers after disposal", async () => {
    const run = vi.fn<AgentToolHandler["run"]>().mockRejectedValue(new Error("signed URL and secret"));
    const clear = vi.fn();
    const executor = new AgentExecutor({ run, clear });
    const result = await executor.execute("error", call, { allowedTools });
    expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(JSON.stringify(result)).not.toContain("secret");
    executor.dispose();
    expect(await executor.execute("new", call, { allowedTools })).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(run).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
  });
});
