import { invoke } from "@tauri-apps/api/core";
import { ModelError, modelErrorCode, type AgentModel, type ModelMessage } from "../core/agent/model";

export interface ModelConnection {
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  tokenParameter: "max_tokens" | "max_completion_tokens";
}
export interface AgentSettings {
  mode: "local" | "cloud";
  local: ModelConnection;
  cloud: ModelConnection;
  cloudConsent: boolean;
  readOnly: boolean;
}
export interface ModelConfig extends ModelConnection { mode: AgentSettings["mode"]; cloudConsent: boolean }
const STORAGE_KEY = "wave:desktop-agent:v1";
export function defaultAgentSettings(): AgentSettings {
  return { mode: "local", local: { baseUrl: "http://127.0.0.1:11434/v1", model: "", jsonMode: true, tokenParameter: "max_tokens" },
    cloud: { baseUrl: "", model: "", jsonMode: true, tokenParameter: "max_completion_tokens" }, cloudConsent: false, readOnly: false };
}
export function modelConfig(settings: AgentSettings): ModelConfig {
  return { ...settings[settings.mode], mode: settings.mode, cloudConsent: settings.cloudConsent };
}
export function validateModelConfig(config: ModelConfig): void {
  try {
    const url = new URL(config.baseUrl);
    if (config.baseUrl.length > 2048 || url.username || url.password || url.search || url.hash
      || (config.mode === "local" ? url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
        : url.protocol !== "https:" || !config.cloudConsent)
      || !config.model.trim() || config.model.length > 200 || [...config.model].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error();
  } catch { throw new ModelError("invalid_config"); }
}

/** Explicit projections prevent pasted secrets or future fields entering ordinary settings. */
function connection(value: unknown, fallback: ModelConnection): ModelConnection {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { baseUrl: typeof v.baseUrl === "string" ? v.baseUrl.slice(0, 2048) : fallback.baseUrl,
    model: typeof v.model === "string" ? v.model.slice(0, 200) : fallback.model,
    jsonMode: typeof v.jsonMode === "boolean" ? v.jsonMode : fallback.jsonMode,
    tokenParameter: v.tokenParameter === "max_tokens" || v.tokenParameter === "max_completion_tokens" ? v.tokenParameter : fallback.tokenParameter };
}
function project(value: unknown): AgentSettings {
  const defaults = defaultAgentSettings();
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { mode: v.mode === "cloud" ? "cloud" : "local", local: connection(v.local, defaults.local),
    cloud: connection(v.cloud, defaults.cloud), cloudConsent: v.cloudConsent === true, readOnly: v.readOnly === true };
}
export function loadAgentSettings(): AgentSettings {
  try { return project(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")); } catch { return defaultAgentSettings(); }
}
export function saveAgentSettings(settings: AgentSettings): void {
  validateModelConfig(modelConfig(settings));
  // Reject credentials in either URL, including an inactive connection.
  for (const value of [settings.local, settings.cloud]) {
    if (!value.baseUrl) continue;
    let url: URL;
    try { url = new URL(value.baseUrl); } catch { throw new ModelError("invalid_config"); }
    if (url.username || url.password || url.search || url.hash) throw new ModelError("invalid_config");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project(settings)));
}

/** Native HTTP owns credentials, URL policy, timeouts and response-size limits. */
export class DesktopAgentModel implements AgentModel {
  private readonly config: ModelConfig;
  constructor(config: ModelConfig) { validateModelConfig(config); this.config = structuredClone(config); }
  async complete(messages: readonly ModelMessage[], signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new ModelError("cancelled");
    let id: string | undefined;
    const cancel = () => { if (id) void invoke("agent_model_cancel", { id }).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      id = await invoke<string>("agent_model_begin");
      if (signal.aborted) { cancel(); throw new ModelError("cancelled"); }
      const result = await invoke<string>("agent_model_complete", { id, config: this.config, messages });
      if (signal.aborted) throw new ModelError("cancelled");
      return result;
    } catch (error) { throw new ModelError(signal.aborted ? "cancelled" : modelErrorCode(error)); }
    finally { signal.removeEventListener("abort", cancel); }
  }
}

export async function testModelConnection(settings: AgentSettings, signal: AbortSignal): Promise<void> {
  const model = new DesktopAgentModel(modelConfig(settings));
  const response = await model.complete([
    { role: "system", content: 'Return exactly this JSON object without Markdown: {"type":"answer","message":"Wave OK"}' },
    { role: "user", content: "Connection test. Return the requested JSON." },
  ], signal);
  let value: unknown;
  try { value = JSON.parse(response); } catch { throw new ModelError("invalid_decision"); }
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).type !== "answer"
    || (value as Record<string, unknown>).message !== "Wave OK") throw new ModelError("invalid_decision");
}
