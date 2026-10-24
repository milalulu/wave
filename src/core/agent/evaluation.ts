import { isAgentDecision } from "./decision.ts";
export { isAgentDecision } from "./decision.ts";
import type { AgentPlaylist, AgentTrack, ToolCall } from "./contract.ts";

export interface EvaluationTask {
  id: string;
  language: "ru" | "en";
  category: string;
  critical: boolean;
  prompt: string;
  context: {
    tracks?: AgentTrack[];
    playlists?: AgentPlaylist[];
    observations?: unknown[];
  };
  expected: (ToolCall | { type: "answer" | "clarify" | "unsupported" })[];
  rubric: string;
}

/** Object order is irrelevant; array order (e.g. EQ bands) is significant. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface DecisionGrade {
  valid: boolean;
  matched: boolean;
  manualReview: boolean;
  reason: "matched" | "invalid_decision" | "unknown_reference" | "not_playable" | "wrong_decision";
}

export function gradeDecision(task: EvaluationTask, value: unknown): DecisionGrade {
  if (!isAgentDecision(value)) return { valid: false, matched: false, manualReview: false, reason: "invalid_decision" };
  if (value.type === "tool") {
    const args = value.args as Record<string, unknown>;
    if (typeof args.trackId === "string") {
      const track = task.context.tracks?.find((t) => t.id === args.trackId);
      if (!track) return { valid: true, matched: false, manualReview: false, reason: "unknown_reference" };
      if (["wave_play", "wave_queue_add"].includes(value.name) && !track.playable) {
        return { valid: true, matched: false, manualReview: false, reason: "not_playable" };
      }
    }
    if (typeof args.playlistId === "string" && !task.context.playlists?.some((p) => p.id === args.playlistId)) {
      return { valid: true, matched: false, manualReview: false, reason: "unknown_reference" };
    }
  }
  const matched = task.expected.some((expected) => expected.type === value.type
    && (expected.type !== "tool" || canonical(expected) === canonical(value)));
  return { valid: true, matched, manualReview: matched && value.type !== "tool", reason: matched ? "matched" : "wrong_decision" };
}

export interface EvaluationSubmission { id: string; decision: unknown; latencyMs?: number; peakMemoryMiB?: number }

export function scoreSubmissions(tasks: readonly EvaluationTask[], submissions: readonly EvaluationSubmission[]) {
  const known = new Set(tasks.map((t) => t.id));
  const counts = new Map<string, number>();
  for (const s of submissions) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  const unknownIds = [...counts.keys()].filter((id) => !known.has(id));
  const duplicateIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const rows = tasks.map((task) => {
    const submission = submissions.find((s) => s.id === task.id);
    const grade = submission && counts.get(task.id) === 1 ? gradeDecision(task, submission.decision) : null;
    return { id: task.id, language: task.language, category: task.category, critical: task.critical,
      valid: grade?.valid ?? false, matched: grade?.matched ?? false, manualReview: grade?.manualReview ?? false,
      reason: counts.get(task.id)! > 1 ? "duplicate" : grade?.reason ?? "missing" };
  });
  const matched = rows.filter((r) => r.matched).length;
  const manualReviewIds = rows.filter((r) => r.manualReview).map((r) => r.id);
  const rates = (key: "language" | "category") => Object.fromEntries([...new Set(rows.map((r) => r[key]))].map((group) => {
    const selected = rows.filter((r) => r[key] === group);
    return [group, { total: selected.length, matched: selected.filter((r) => r.matched).length }];
  }));
  return { total: tasks.length, matched, routingAccuracy: tasks.length ? matched / tasks.length : 0,
    formatValid: rows.filter((r) => r.valid).length,
    missing: rows.filter((r) => r.reason === "missing").length,
    unknownIds, duplicateIds, manualReviewIds,
    criticalPassed: rows.filter((r) => r.critical).every((r) => r.matched) && !unknownIds.length && !duplicateIds.length,
    automatedPassed: matched === tasks.length && !unknownIds.length && !duplicateIds.length,
    byLanguage: rates("language"), byCategory: rates("category"), rows };
}
