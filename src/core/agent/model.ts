/** Provider-neutral chat boundary. Credentials never enter this interface. */
export interface ModelMessage { role: "system" | "user" | "assistant"; content: string }
export interface AgentModel {
  complete(messages: readonly ModelMessage[], signal: AbortSignal): Promise<string>;
}

export const MODEL_ERROR_CODES = ["cancelled", "timeout", "connection_failed", "authentication_failed",
  "rate_limited", "provider_error", "invalid_response", "response_too_large", "invalid_config",
  "key_missing", "key_store_unavailable", "context_limit", "invalid_decision", "step_limit",
  "repeated_action", "effect_unknown", "session_limit", "internal_error"] as const;
export type ModelErrorCode = typeof MODEL_ERROR_CODES[number];
export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode) { super(code); this.code = code; }
}
export function modelErrorCode(error: unknown): ModelErrorCode {
  if (error instanceof ModelError) return error.code;
  return typeof error === "string" && (MODEL_ERROR_CODES as readonly string[]).includes(error)
    ? error as ModelErrorCode : "internal_error";
}
