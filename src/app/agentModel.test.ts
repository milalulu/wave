import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { DesktopAgentModel, defaultAgentSettings, loadAgentSettings, modelConfig, saveAgentSettings, testModelConnection, validateModelConfig } from "./agentModel";

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
const config = () => ({ ...modelConfig(defaultAgentSettings()), model: "fixture" });

describe("desktop model adapter", () => {
  it("does not contact native transport for cloud without explicit consent", () => {
    expect(() => new DesktopAgentModel({ ...config(), mode: "cloud", baseUrl: "https://api.example/v1" })).toThrow("invalid_config");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["http://localhost:11434/v1", "https://example.com/v1", "http://127.0.0.1.evil.test/v1", "http://key:secret@127.0.0.1/v1", "http://127.0.0.1/v1?token=secret"])(
    "rejects unsafe local URL %s", (baseUrl) => expect(() => validateModelConfig({ ...config(), baseUrl })).toThrow("invalid_config"));
  it("cancels even when abort arrives before native request registration completes", async () => {
    let register!: (id: string) => void;
    vi.mocked(invoke).mockImplementation((command) => command === "agent_model_begin" ? new Promise((r) => { register = r as typeof register; }) : Promise.resolve());
    const controller = new AbortController();
    const pending = new DesktopAgentModel(config()).complete([], controller.signal);
    controller.abort(); register("42");
    await expect(pending).rejects.toThrow("cancelled");
    expect(invoke).toHaveBeenCalledWith("agent_model_cancel", { id: "42" });
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "agent_model_complete")).toBe(false);
  });
  it("sanitizes unknown IPC failures and makes no fallback or retry", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockRejectedValueOnce("server response containing secret");
    await expect(new DesktopAgentModel(config()).complete([], new AbortController().signal)).rejects.toThrow("internal_error");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("persists only nonsecret settings and rejects credentials in inactive URLs", () => {
    const settings = defaultAgentSettings(); settings.local.model = "fixture";
    saveAgentSettings({ ...settings, apiKey: "secret" } as typeof settings);
    expect(loadAgentSettings()).toEqual(settings);
    expect(localStorage.getItem("wave:desktop-agent:v1")).not.toContain("secret");
    settings.cloud.baseUrl = "https://user:secret@api.example/v1";
    expect(() => saveAgentSettings(settings)).toThrow("invalid_config");
  });
  it("tests only with synthetic messages and checks the decision format", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockResolvedValueOnce('{"type":"answer","message":"Wave OK"}');
    const settings = defaultAgentSettings(); settings.local.model = "fixture";
    await testModelConnection(settings, new AbortController().signal);
    const request = vi.mocked(invoke).mock.calls[1][1];
    expect(request).toMatchObject({ messages: [{ role: "system" }, { role: "user", content: "Connection test. Return the requested JSON." }] });
    expect(request).not.toHaveProperty("config.structuredOutput");
    expect(request).not.toHaveProperty("config.responseSchema");
    expect(JSON.stringify(request)).not.toContain("wave_liked");
  });
  it("migrates old settings without silently opting into a different output mode", () => {
    localStorage.setItem("wave:desktop-agent:v1", JSON.stringify({ local: { model: "old", jsonMode: false } }));
    expect(loadAgentSettings().local).toMatchObject({ model: "old", jsonMode: false, structuredOutput: false });
  });
  it("sends a strict schema and wrapped history, then validates and unwraps the reply", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockResolvedValueOnce('{"decision":{"type":"answer","message":"ok"}}');
    const input = [{ role: "system" as const, content: "rules" }, { role: "assistant" as const, content: '{"type":"tool","name":"wave_status","args":{}}' }];
    const model = new DesktopAgentModel({ ...config(), structuredOutput: true }, { readOnly: true });
    await expect(model.complete(input, new AbortController().signal)).resolves.toBe('{"type":"answer","message":"ok"}');
    const request = vi.mocked(invoke).mock.calls[1][1];
    expect(JSON.stringify(request)).toContain("wave_status");
    expect(JSON.stringify(request)).not.toContain('"wave_play"');
    expect(request).toMatchObject({ config: { structuredOutput: true, responseSchema: { type: "object", required: ["decision"] } } });
    expect(input[0].content).toBe("rules");
  });
  it("does not downgrade strict mode when the server rejects it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockRejectedValueOnce("provider_error");
    await expect(new DesktopAgentModel({ ...config(), structuredOutput: true }).complete([], new AbortController().signal)).rejects.toThrow("provider_error");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("rejects a server ignoring the requested strict envelope", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockResolvedValueOnce('{"type":"tool","name":"wave_pause","args":{}}');
    await expect(new DesktopAgentModel({ ...config(), structuredOutput: true }).complete([], new AbortController().signal)).rejects.toThrow("invalid_decision");
  });
  it("uses a text-only strict schema for the connection probe", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1").mockResolvedValueOnce('{"decision":{"type":"answer","message":"Wave OK"}}');
    const settings = defaultAgentSettings(); Object.assign(settings.local, { model: "fixture", structuredOutput: true });
    await testModelConnection(settings, new AbortController().signal);
    expect(JSON.stringify(vi.mocked(invoke).mock.calls[1][1])).not.toContain("wave_liked");
  });
});
