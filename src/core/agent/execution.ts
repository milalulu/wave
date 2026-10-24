import type { AgentErrorCode, ToolName, ToolResult } from "./contract";

export class AgentFault extends Error {
  readonly code: AgentErrorCode;
  constructor(code: AgentErrorCode) {
    super(code);
    this.code = code;
  }
}

const messages: Record<AgentErrorCode, string> = {
  invalid_arguments: "Invalid tool arguments.", unknown_tool: "Unknown tool.",
  unknown_reference: "Read or search for this item again before using its ID.",
  not_found: "The requested item no longer exists.", not_playable: "This item cannot be played.",
  empty_queue: "There are no tracks to play.", out_of_range: "The requested position is outside the track.",
  provider_unavailable: "The music source is unavailable.", cancelled: "The request was cancelled.",
  timeout: "The request timed out.", platform_unavailable: "The agent is only available in the desktop app.",
  internal_error: "Wave could not complete this action.", request_conflict: "This request ID was already used for a different action.",
  session_limit: "Start a new agent session to continue.", permission_denied: "This tool is not allowed for the current request.",
  playback_failed: "Wave did not start the requested playback.",
};

export function failure(code: AgentErrorCode, started = false): ToolResult<ToolName> {
  return { ok: false, error: { code, message: messages[code], retryable: false, effect: started ? "unknown" : "not_started" } };
}

export class ExecutionScope {
  started = false;
  readonly signal: AbortSignal;
  constructor(signal: AbortSignal) { this.signal = signal; }
  check(): void {
    if (this.signal.aborted) throw new AgentFault(this.signal.reason === "timeout" ? "timeout" : "cancelled");
  }
  /** Call immediately before the first observable mutation, after asynchronous preparation. */
  commit(): void { this.check(); this.started = true; }
}
