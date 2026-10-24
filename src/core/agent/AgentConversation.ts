import type { AgentExecutor } from "./AgentExecutor";
import { AGENT_TOOLS } from "./catalog";
import type { AgentDecision, ToolCall, ToolName, ToolResult } from "./contract";
import { isAgentDecision } from "./decision";
import { ModelError, modelErrorCode, type AgentModel, type ModelErrorCode, type ModelMessage } from "./model";
import { compactPrompt } from "./protocol";
import { AGENT_RUNTIME_PROMPT } from "./prompt";

export type ConversationEvent = { type: "user"; text: string }
  | { type: "assistant"; decision: Exclude<AgentDecision, ToolCall> }
  | { type: "tool"; id: string; call: ToolCall; result: ToolResult<ToolName> }
  | { type: "error"; code: ModelErrorCode };
export interface ConversationState { events: readonly ConversationEvent[]; busy: boolean; uncertain: boolean }

/** One conversation per executor. No background work, fallback or automatic retries. */
export class AgentConversation {
  private state: ConversationState = { events: [], busy: false, uncertain: false };
  private listeners = new Set<() => void>();
  private messages: ModelMessage[];
  private controller?: AbortController;
  private sequence = 0;
  private readonly requestPrefix = crypto.randomUUID();
  private uncertainId?: string;
  private closed = false;
  private readonly allowedTools: ToolName[];
  private readonly model: AgentModel;
  private readonly executor: AgentExecutor;
  private readonly timeoutMs: number;

  constructor(model: AgentModel, executor: AgentExecutor, options: { readOnly?: boolean; timeoutMs?: number; compactContext?: boolean } = {}) {
    this.model = model;
    this.executor = executor;
    this.timeoutMs = Math.min(180000, Math.max(1, options.timeoutMs ?? 180000));
    this.allowedTools = (Object.keys(AGENT_TOOLS) as ToolName[]).filter((name) => !options.readOnly || AGENT_TOOLS[name].effect === "read");
    this.messages = [{ role: "system", content: options.compactContext ? compactPrompt(this.allowedTools)
      : `${AGENT_RUNTIME_PROMPT}\nAvailable tools:\n${JSON.stringify(Object.fromEntries(this.allowedTools.map((name) => [name, AGENT_TOOLS[name]])))}` }];
  }

  getSnapshot = (): ConversationState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<ConversationState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private emit(event: ConversationEvent) {
    // Bound repeated errors as well as successful turns. Never discard active tool receipts.
    if (this.state.events.length >= 180) return;
    this.update({ events: [...this.state.events, event] });
  }
  cancel(): void { this.controller?.abort("cancelled"); }
  dispose(): void { this.closed = true; this.cancel(); }

  /** Reconcile without replaying a timed-out mutation. Unknown outcomes remain explicit. */
  reconcile(): boolean {
    if (!this.uncertainId) return true;
    const result = this.executor.result(this.uncertainId);
    if (!result || (!result.ok && result.error.effect === "unknown")) return false;
    const event = this.state.events.find((e) => e.type === "tool" && e.id === this.uncertainId);
    if (event?.type === "tool") {
      this.messages.push({ role: "user", content: JSON.stringify({ type: "tool_result", name: event.call.name, result }) });
      this.update({ events: this.state.events.map((e) => e === event ? { ...event, result } : e), uncertain: false });
    }
    this.uncertainId = undefined;
    return true;
  }

  async send(text: string): Promise<void> {
    if (this.closed || this.state.busy || !text.trim() || text.length > 2000) return;
    if (!this.reconcile()) { this.emit({ type: "error", code: "effect_unknown" }); return; }
    if (this.state.events.length >= 160) { this.emit({ type: "error", code: "session_limit" }); return; }
    const controller = new AbortController();
    this.controller = controller;
    const check = () => { if (controller.signal.aborted) throw new ModelError(controller.signal.reason === "timeout" ? "timeout" : "cancelled"); };
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    this.update({ busy: true });
    this.emit({ type: "user", text: text.trim() });
    this.messages.push({ role: "user", content: JSON.stringify({ type: "user_request", text: text.trim() }) });
    const changes = new Set<string>();
    try {
      for (let step = 0; step < 9; step++) {
        check();
        if (this.messages.length > 80 || new TextEncoder().encode(JSON.stringify(this.messages)).length > 96000) throw new ModelError("context_limit");
        // Race even an uncooperative adapter; a late response can never execute a tool.
        const raw = await abortable(this.model.complete(structuredClone(this.messages), controller.signal), controller.signal);
        check();
        if (typeof raw !== "string" || raw.length > 16000) throw new ModelError("invalid_decision");
        let decision: unknown;
        try { decision = JSON.parse(raw); } catch { throw new ModelError("invalid_decision"); }
        if (!isAgentDecision(decision)) throw new ModelError("invalid_decision");
        if (decision.type !== "tool") {
          this.messages.push({ role: "assistant", content: JSON.stringify(decision) });
          this.emit({ type: "assistant", decision });
          return;
        }
        if (step === 8) throw new ModelError("step_limit");
        const fingerprint = JSON.stringify([decision.name, Object.entries(decision.args).sort(([a], [b]) => a.localeCompare(b))]);
        if (AGENT_TOOLS[decision.name].effect !== "read") {
          if (changes.has(fingerprint)) throw new ModelError("repeated_action");
          changes.add(fingerprint);
        }
        const id = `chat:${this.requestPrefix}:${++this.sequence}`;
        this.messages.push({ role: "assistant", content: JSON.stringify(decision) });
        const result = await this.executor.execute(id, decision, { allowedTools: this.allowedTools, signal: controller.signal });
        this.messages.push({ role: "user", content: JSON.stringify({ type: "tool_result", name: decision.name, result }) });
        this.emit({ type: "tool", id, call: decision, result });
        if (!result.ok) {
          if (result.error.effect === "unknown") {
            this.uncertainId = id;
            this.update({ uncertain: true });
          }
          // Any tool failure ends this turn: the model cannot improvise a replacement mutation.
          return;
        }
      }
    } catch (error) {
      const code = controller.signal.aborted ? (controller.signal.reason === "timeout" ? "timeout" : "cancelled") : modelErrorCode(error);
      this.messages.push({ role: "user", content: JSON.stringify({ type: "turn_stopped", reason: code, instruction: "Do not continue this request unless the user asks again. Completed actions are not undone." }) });
      this.emit({ type: "error", code });
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
      this.update({ busy: false });
    }
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ModelError("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
