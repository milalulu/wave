import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { AGENT_TOOLS } from "../src/core/agent/catalog.ts";
import { unwrapDecision } from "../src/core/agent/protocol.ts";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const normalized = (text) => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const grams = (text) => {
  const words = normalized(text).split(" ");
  return new Set(words.slice(2).map((_, i) => words.slice(i, i + 3).join(" ")));
};
export const promptSignature = (text) => [...grams(text)].map(hash);
const overlaps = (left, right) => Math.min(left.length, right.length) >= 6
  && left.filter((g) => right.includes(g)).length / Math.min(left.length, right.length) >= .8;
export function nearDuplicate(a, b) {
  if (normalized(a) === normalized(b)) return true;
  const left = grams(a); const right = grams(b);
  if (Math.min(left.size, right.size) < 6) return false;
  const shared = [...left].filter((g) => right.has(g)).length;
  return shared / Math.min(left.size, right.size) >= .8;
}

/** This catches mechanical leakage, not semantic paraphrases. Human review is separate.
 * @param {Array} scenarios
 * @param {Array} publicTasks
 * @param {{familyHashes: string[], promptHashes: string[], promptGramHashes?: string[][]}} reserved
 */
export function validateSources(scenarios, publicTasks, reserved = { familyHashes: [], promptHashes: [] }, requireCoverage = true) {
  assert(Array.isArray(scenarios) && scenarios.length > 0, "Empty corpus");
  const ids = new Set(); const families = new Map(); const prompts = []; const tools = new Set();
  const languages = new Map();
  for (const s of scenarios) {
    assert(/^[a-z0-9-]+$/.test(s.id) && !ids.has(s.id), "Invalid/duplicate dialogue ID"); ids.add(s.id);
    assert(["train", "dev", "holdout"].includes(s.split));
    assert(["ru", "en"].includes(s.language));
    assert(typeof s.critical === "boolean" && typeof s.rubric === "string" && s.rubric.length > 20);
    assert(typeof s.family === "string" && s.family.length > 0);
    assert(!families.has(s.family) || families.get(s.family) === s.split, "Family crosses splits"); families.set(s.family, s.split);
    if (s.split !== "holdout") assert(!reserved.familyHashes.includes(hash(s.family)), "Reserved holdout family");
    languages.set(s.split, new Set([...(languages.get(s.split) ?? []), s.language]));
    assert(s.fixture && Array.isArray(s.fixture.tracks) && s.fixture.search);
    assert(new Set(s.fixture.tracks.map((t) => t.key)).size === s.fixture.tracks.length, "Duplicate fixture key");
    assert(Array.isArray(s.turns) && s.turns.length > 0);
    for (const turn of s.turns) {
      assert(typeof turn.user === "string" && turn.user.trim().length > 0 && turn.user.length <= 2000);
      assert(!publicTasks.some((t) => nearDuplicate(turn.user, t.prompt)), `${s.id}: public evaluation overlap`);
      if (s.split !== "holdout") assert(!reserved.promptHashes.includes(hash(normalized(turn.user))), "Reserved holdout prompt");
      if (s.split !== "holdout") assert(!(reserved.promptGramHashes ?? []).some((p) => overlaps(promptSignature(turn.user), p)), "Near-duplicate holdout prompt");
      assert(!prompts.some((p) => p.split !== s.split && nearDuplicate(p.text, turn.user)), "Prompt crosses splits");
      prompts.push({ split: s.split, text: turn.user });
      assert(turn.expect && Object.keys(turn.expect).length >= 2);
      assert(Array.isArray(turn.steps) && turn.steps.length > 0 && turn.steps.length <= 9);
      for (const [i, step] of turn.steps.entries()) {
        if (step.name) {
          assert(Object.hasOwn(AGENT_TOOLS, step.name) && typeof step.as === "string" && step.as.length);
          if (s.split === "train") tools.add(step.name);
          if (step.error) assert.equal(i, turn.steps.length - 1, "Tool error must end the turn");
        } else {
          assert.equal(i, turn.steps.length - 1, "Text decision must end the turn");
          unwrapDecision(JSON.stringify({ decision: step }));
        }
      }
      const last = turn.steps.at(-1);
      assert(!last.name || last.error, "Successful tools need a final decision");
    }
  }
  if (requireCoverage) {
    assert.deepEqual([...tools].sort(), Object.keys(AGENT_TOOLS).sort(), "Training must cover all tools");
    for (const split of ["train", "dev"]) assert.equal(languages.get(split)?.size, 2, "Both languages required in public splits");
  }
  return { dialogues: scenarios.length, families: families.size, tools: [...tools].sort() };
}

/** Derive reference context only from actual receipts in each frozen input prefix. */
export function holdoutTasks(targets, inputs) {
  const byId = new Map(inputs.map((input) => [input.id, input]));
  assert.equal(byId.size, inputs.length, "Duplicate input ID");
  assert.equal(targets.length, inputs.length, "Missing holdout inputs");
  return targets.map((target) => {
    const input = byId.get(target.id); assert(input, "Missing holdout input");
    const tracks = new Map(); const playlists = new Map();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string") {
        if (typeof value.playable === "boolean" && typeof value.title === "string") tracks.set(value.id, value);
        if (typeof value.trackCount === "number" && typeof value.name === "string") playlists.set(value.id, value);
      }
      Object.values(value).forEach(visit);
    };
    for (const message of input.messages) if (message.role === "user") {
      const data = JSON.parse(message.content);
      if (data.type === "tool_result" && data.result.ok) visit(data.result.data);
    }
    return { id: target.id, language: target.language, category: target.family, critical: target.critical,
      rubric: target.rubric, prompt: "Frozen teacher prefix", context: { tracks: [...tracks.values()], playlists: [...playlists.values()] },
      expected: [target.decision.type === "tool" ? target.decision : { type: target.decision.type }] };
  });
}

export function validateSamples(samples) {
  const ids = new Set();
  for (const sample of samples) {
    assert(!ids.has(sample.id), "Duplicate sample ID"); ids.add(sample.id);
    assert(sample.prompt.length > 1 && sample.prompt[0].role === "system");
    assert.equal(sample.completion.length, 1); assert.equal(sample.completion[0].role, "assistant");
    const decision = JSON.parse(unwrapDecision(sample.completion[0].content));
    const observed = new Set();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string") observed.add(value.id);
      Object.values(value).forEach(visit);
    };
    for (const message of sample.prompt) {
      assert(["system", "user", "assistant"].includes(message.role));
      if (message.role === "user") {
        const data = JSON.parse(message.content);
        assert(["user_request", "tool_result", "turn_stopped"].includes(data.type));
        if (data.type === "tool_result" && data.result.ok) visit(data.result.data);
      } else if (message.role === "assistant") unwrapDecision(message.content);
    }
    if (decision.type === "tool") for (const field of ["trackId", "playlistId"]) {
      if (field in decision.args) assert(observed.has(decision.args[field]), "Target uses an unobserved ID");
    }
    const data = JSON.stringify({ prompt: sample.prompt, completion: sample.completion });
    assert(!/fixture:\/|internal-|\/home\/|file:\/\/|https?:\/\//.test(data), "Private locator in model input");
    assert(Buffer.byteLength(JSON.stringify(sample.prompt)) < 80000, "Dataset exceeds runtime context budget");
  }
}
