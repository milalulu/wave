import { isToolName, validateArguments } from "./catalog.ts";
import type { AgentDecision } from "./contract.ts";

export function isAgentDecision(value: unknown): value is AgentDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (d.type === "tool") {
    return Object.keys(d).length === 3 && typeof d.name === "string" && isToolName(d.name) && validateArguments(d.name, d.args);
  }
  return Object.keys(d).length === 2 && typeof d.type === "string" && ["answer", "clarify", "unsupported"].includes(d.type)
    && typeof d.message === "string" && d.message.trim().length > 0 && d.message.length <= 2000;
}
