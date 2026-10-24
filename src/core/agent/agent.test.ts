import { describe, expect, it } from "vitest";
import tasksJson from "../../../evals/wave-agent/v1/tasks.json";
import { AGENT_TOOLS, isToolName, validateArguments } from "./catalog";
import { gradeDecision, isAgentDecision, scoreSubmissions, type EvaluationTask } from "./evaluation";

const tasks = tasksJson as EvaluationTask[];
const task = (id: string) => tasks.find((t) => t.id === id)!;

describe("agent contract", () => {
  it("rejects unknown tools, extra fields and coercion", () => {
    expect(isToolName("__proto__")).toBe(false);
    expect(isToolName("shell")).toBe(false);
    expect(validateArguments("wave_pause", { trackId: "invented" })).toBe(false);
    expect(validateArguments("wave_volume", { percent: "25" })).toBe(false);
    expect(validateArguments("wave_shuffle", { enabled: "false" })).toBe(false);
    expect(validateArguments("wave_search", { query: "  ", limit: 5 })).toBe(false);
    expect(isAgentDecision({ type: "tool", name: "wave_volume", args: { percent: 25 }, execute: true })).toBe(false);
    expect(isAgentDecision({ type: { toString: null, valueOf: null }, message: "bad type" })).toBe(false);
  });

  it.each([-1, 101, NaN, Infinity])("rejects invalid volume %s instead of clamping", (percent) => {
    expect(validateArguments("wave_volume", { percent })).toBe(false);
  });

  it("enforces pagination, speed and EQ limits", () => {
    expect(validateArguments("wave_queue", { offset: 0.5, limit: 20 })).toBe(false);
    expect(validateArguments("wave_queue", { offset: 0, limit: 51 })).toBe(false);
    expect(validateArguments("wave_speed", { rate: 4 })).toBe(false);
    expect(validateArguments("wave_equalizer", { gainsDb: [0] })).toBe(false);
    expect(validateArguments("wave_equalizer", { gainsDb: Array(10) })).toBe(false);
    expect(validateArguments("wave_equalizer", { gainsDb: Array(10).fill(13) })).toBe(false);
    expect(validateArguments("wave_equalizer", { gainsDb: Array(10).fill(0) })).toBe(true);
  });

  it("requires grounded IDs and playable tracks", () => {
    expect(gradeDecision(task("play-known-ru"), { type: "tool", name: "wave_play", args: { trackId: "invented" } }).reason).toBe("unknown_reference");
    expect(gradeDecision(task("preview-only-en"), { type: "tool", name: "wave_play", args: { trackId: "track:orbit" } }).reason).toBe("not_playable");
    expect(gradeDecision(task("playlist-add-en"), { type: "tool", name: "wave_playlist_add", args: { trackId: "track:orbit", playlistId: "invented" } }).reason).toBe("unknown_reference");
  });
});

describe("agent evaluation", () => {
  it("covers every tool and has valid grounded reference decisions in both languages", () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    expect(new Set(tasks.map((t) => t.language))).toEqual(new Set(["ru", "en"]));
    const covered = new Set<string>();
    for (const t of tasks) for (const expected of t.expected) {
      const decision = expected.type === "tool" ? expected : { ...expected, message: "manual review" };
      expect(gradeDecision(t, decision).matched, t.id).toBe(true);
      if (expected.type === "tool") covered.add(expected.name);
    }
    expect([...covered].sort()).toEqual(Object.keys(AGENT_TOOLS).sort());
  });

  it("does not grant success for omitted, duplicate or unknown cases", () => {
    const s = { id: "pause-ru", decision: { type: "tool", name: "wave_pause", args: {} } };
    const partial = scoreSubmissions(tasks, [s]);
    expect(partial.matched).toBe(1);
    expect(partial.missing).toBe(tasks.length - 1);
    expect(partial.automatedPassed).toBe(false);
    const duplicate = scoreSubmissions(tasks, [s, s, { ...s, id: "invented" }]);
    expect(duplicate.matched).toBe(0);
    expect(duplicate.duplicateIds).toEqual(["pause-ru"]);
    expect(duplicate.unknownIds).toEqual(["invented"]);
    expect(duplicate.criticalPassed).toBe(false);
  });

  it("scores argument meaning independently of JSON key order", () => {
    expect(gradeDecision(task("queue-next-ru"), { args: { position: "next", trackId: "track:orbit" }, name: "wave_queue_add", type: "tool" }).matched).toBe(true);
    expect(gradeDecision(task("queue-next-ru"), { type: "tool", name: "wave_play", args: { trackId: "track:orbit" } }).matched).toBe(false);
  });

  it("marks prose for human review even when the decision category matches", () => {
    const grade = gradeDecision(task("empty-search-en"), { type: "answer", message: "Playing now!" });
    expect(grade.matched).toBe(true);
    expect(grade.manualReview).toBe(true); // Routing alone must not certify this incorrect claim.
    expect(isAgentDecision({ type: "answer", message: " " })).toBe(false);
  });
});
