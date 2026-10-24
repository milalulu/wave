import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConversation } from "./AgentConversation";
import { AgentExecutor, type AgentToolHandler } from "./AgentExecutor";
import type { AgentModel, ModelMessage } from "./model";
import type { ToolResult, ToolName } from "./contract";

const answer = JSON.stringify({ type: "answer", message: "Готово" });
const change = JSON.stringify({ type: "tool", name: "wave_playlist_create", args: { name: "Focus" } });
const success: ToolResult<ToolName> = { ok: true, data: { id: "p1", name: "Focus", trackCount: 0 } };
function setup(responses: string[], readOnly = false, compactContext = false) {
  const run = vi.fn<AgentToolHandler["run"]>().mockResolvedValue(success);
  const executor = new AgentExecutor({ run, clear: () => {} });
  const complete = vi.fn<AgentModel["complete"]>();
  responses.forEach((response) => complete.mockResolvedValueOnce(response));
  const chat = new AgentConversation({ complete }, executor, { readOnly, compactContext });
  return { chat, run, complete, executor };
}
afterEach(() => vi.useRealTimers());

describe("bounded model conversation", () => {
  it.each([false, true])("returns real observations and retains clarification context (compact=%s)", async (compactContext) => {
    const { chat, run, complete } = setup([JSON.stringify({ type: "clarify", message: "Как назвать?" }), change, answer], false, compactContext);
    await chat.send("Создай плейлист");
    expect(run).not.toHaveBeenCalled();
    await chat.send("Focus");
    expect(run).toHaveBeenCalledOnce();
    const messages = complete.mock.calls[2][0];
    expect(messages.some((m) => m.content.includes("Как назвать?"))).toBe(true);
    expect(JSON.parse(messages[messages.length - 1].content)).toMatchObject({ type: "tool_result", result: success });
    expect(chat.getSnapshot().events.map((e) => e.type)).toEqual(["user", "assistant", "user", "tool", "assistant"]);
  });

  it.each(['```json\n{}\n```', '{"type":"tool","name":"wave_volume","args":{"percent":101}}', '{"type":"tool","name":"shell","args":{}}', 'not json'])(
    "never executes invalid model decisions: %s", async (response) => {
      const { chat, run } = setup([response]);
      await chat.send("test");
      expect(run).not.toHaveBeenCalled();
      expect(chat.getSnapshot().events.slice(-1)[0]).toEqual({ type: "error", code: "invalid_decision" });
    });

  it.each([false, true])("enforces read-only outside model output (compact=%s)", async (compactContext) => {
    const { chat, run, complete } = setup([change], true, compactContext);
    await chat.send("Создай плейлист");
    expect(run).not.toHaveBeenCalled();
    expect(complete.mock.calls[0][0][0].content).not.toContain('wave_playlist_create');
    expect(chat.getSnapshot().events.slice(-1)[0]).toMatchObject({ type: "tool", result: { ok: false, error: { code: "permission_denied" } } });
  });

  it("stops repeat changes and bounds model-driven loops", async () => {
    const repeated = setup([change, change, answer]);
    await repeated.chat.send("test");
    expect(repeated.run).toHaveBeenCalledOnce();
    expect(repeated.chat.getSnapshot().events.slice(-1)[0]).toEqual({ type: "error", code: "repeated_action" });
    const looping = setup(Array(9).fill(JSON.stringify({ type: "tool", name: "wave_status", args: {} })));
    await looping.chat.send("test");
    expect(looping.run).toHaveBeenCalledTimes(8);
    expect(looping.chat.getSnapshot().events.slice(-1)[0]).toEqual({ type: "error", code: "step_limit" });
  });

  it("discards a late model response after cancellation and refuses overlapping turns", async () => {
    let finish!: (response: string) => void;
    const { chat, complete, run } = setup([]);
    complete.mockReturnValueOnce(new Promise((r) => { finish = r; })).mockResolvedValue(answer);
    const pending = chat.send("first");
    await chat.send("overlap");
    chat.cancel(); await pending;
    await chat.send("second");
    finish(change); await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    expect(chat.getSnapshot().events.filter((e) => e.type === "user")).toEqual([{ type: "user", text: "first" }, { type: "user", text: "second" }]);
  });

  it("times out a hung model without executing its late answer", async () => {
    vi.useFakeTimers();
    const executor = new AgentExecutor({ run: vi.fn(), clear: () => {} });
    const chat = new AgentConversation({ complete: () => new Promise(() => {}) }, executor, { timeoutMs: 50 });
    const pending = chat.send("test");
    await vi.advanceTimersByTimeAsync(51); await pending;
    expect(chat.getSnapshot().busy).toBe(false);
    expect(chat.getSnapshot().events.slice(-1)[0]).toEqual({ type: "error", code: "timeout" });
  });

  it("blocks further turns while a timed-out write is unsettled, then reconciles without replay", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi.fn<AgentToolHandler["run"]>().mockImplementation(async (_call, scope) => {
      scope.commit(); await new Promise<void>((r) => { finish = r; }); return success;
    });
    const executor = new AgentExecutor({ run, clear: () => {} }, { timeoutMs: 50 });
    const complete = vi.fn<AgentModel["complete"]>().mockResolvedValueOnce(change).mockResolvedValue(answer);
    const chat = new AgentConversation({ complete }, executor);
    const pending = chat.send("create");
    await vi.advanceTimersByTimeAsync(51); await pending;
    expect(chat.getSnapshot().uncertain).toBe(true);
    await chat.send("try again");
    expect(complete).toHaveBeenCalledOnce();
    finish(); await executor.whenIdle();
    expect(chat.reconcile()).toBe(true);
    expect(chat.getSnapshot().uncertain).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(chat.getSnapshot().events.find((e) => e.type === "tool")).toMatchObject({ result: success });
  });

  it("sanitizes errors and never silently trims oversized context", async () => {
    const { chat, complete } = setup([]);
    complete.mockRejectedValueOnce(new Error("secret URL and key"));
    await chat.send("test");
    expect(JSON.stringify(chat.getSnapshot())).not.toContain("secret");
    complete.mockResolvedValue(answer);
    for (let i = 0; i < 50; i++) await chat.send("я".repeat(2000));
    expect(chat.getSnapshot().events).toContainEqual({ type: "error", code: "context_limit" });
    expect(complete.mock.calls.length).toBeLessThan(50);
  });

  it("copies messages before exposing them to an adapter", async () => {
    const { chat, complete } = setup([]);
    complete.mockImplementation(async (messages: readonly ModelMessage[]) => {
      expect(messages[0].content).toContain("Wave");
      (messages as ModelMessage[])[0].content = "tampered";
      return answer;
    });
    await chat.send("one"); await chat.send("two");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
