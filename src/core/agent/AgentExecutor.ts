import { isToolName, validateArguments } from "./catalog";
import type { ToolCall, ToolName, ToolResult } from "./contract";
import { AgentFault, ExecutionScope, failure } from "./execution";

export interface AgentToolHandler {
  run(call: ToolCall, scope: ExecutionScope): Promise<ToolResult<ToolName>>;
  clear(): void;
}
export interface ExecutionOptions {
  /** Supplied by the trusted application, never by model output. */
  allowedTools: readonly ToolName[];
  signal?: AbortSignal;
}
interface Entry {
  fingerprint: string;
  controller: AbortController;
  response: Promise<ToolResult<ToolName>>;
  result?: ToolResult<ToolName>;
}

/** Bounded session, one execution lane, retained request IDs and cooperative cancellation. */
export class AgentExecutor {
  private entries = new Map<string, Entry>();
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly handler: AgentToolHandler;
  private readonly timeoutMs: number;
  private readonly maxRequests: number;

  constructor(handler: AgentToolHandler, options: { timeoutMs?: number; maxRequests?: number } = {}) {
    this.handler = handler;
    this.timeoutMs = Math.min(60000, Math.max(1, options.timeoutMs ?? 15000));
    this.maxRequests = Math.min(256, Math.max(1, options.maxRequests ?? 128));
  }

  execute(requestId: string, value: unknown, options: ExecutionOptions): Promise<ToolResult<ToolName>> {
    if (this.disposed) return Promise.resolve(failure("cancelled"));
    if (typeof requestId !== "string" || !/^[\w:-]{1,128}$/.test(requestId)) return Promise.resolve(failure("invalid_arguments"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return Promise.resolve(failure("invalid_arguments"));
    const raw = value as Record<string, unknown>;
    if (typeof raw.name !== "string" || !isToolName(raw.name)) return Promise.resolve(failure("unknown_tool"));
    if (raw.type !== "tool" || Object.keys(raw).length !== 3 || !validateArguments(raw.name, raw.args)) return Promise.resolve(failure("invalid_arguments"));
    if (!options.allowedTools.includes(raw.name)) return Promise.resolve(failure("permission_denied"));
    // Copy before enqueueing: callers cannot modify arguments while this request waits.
    const call = structuredClone(value) as ToolCall;
    const fingerprint = JSON.stringify([call.name, Object.entries(call.args).sort(([a], [b]) => a.localeCompare(b))]);
    const existing = this.entries.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.resolve(failure("request_conflict"));
      return (existing.result ? Promise.resolve(existing.result) : existing.response).then((r) => structuredClone(r));
    }
    // Never evict completed request IDs and accidentally repeat a mutation.
    if (this.entries.size >= this.maxRequests) return Promise.resolve(failure("session_limit"));
    const controller = new AbortController();
    const scope = new ExecutionScope(controller.signal);
    const abort = () => controller.abort("cancelled");
    let settle!: (result: ToolResult<ToolName>) => void;
    const response = new Promise<ToolResult<ToolName>>((resolve) => { settle = resolve; });
    const entry: Entry = { fingerprint, controller, response };
    this.entries.set(requestId, entry);
    const early = () => settle(failure(controller.signal.reason === "timeout" ? "timeout" : "cancelled", scope.started));
    controller.signal.addEventListener("abort", early, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    const work = this.tail.then(async () => {
      try {
        scope.check();
        entry.result = await this.handler.run(call, scope);
      } catch (error) {
        const code = controller.signal.aborted ? (controller.signal.reason === "timeout" ? "timeout" : "cancelled")
          : error instanceof AgentFault ? error.code : "internal_error";
        entry.result = failure(code, scope.started);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", early);
      }
      settle(entry.result!);
    });
    // Keep the lock until the underlying work settles, even if the caller timed out.
    this.tail = work;
    return response.then((r) => structuredClone(r));
  }

  cancel(requestId: string): void { this.entries.get(requestId)?.controller.abort("cancelled"); }
  /** Reset must wait for underlying writes, even after an early timeout response. */
  whenIdle(): Promise<void> { return this.tail.then(() => undefined); }
  result(requestId: string): ToolResult<ToolName> | null {
    const result = this.entries.get(requestId)?.result;
    return result ? structuredClone(result) : null;
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.controller.abort("cancelled");
    this.handler.clear();
  }
}
