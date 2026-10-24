import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { URL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, normalized, validateSources, validateSamples, nearDuplicate, promptSignature, holdoutTasks } from "./agent-data-lib.mjs";
import { scoreSubmissions } from "../src/core/agent/evaluation.ts";

const source = JSON.parse(readFileSync(new URL("../training/wave-agent/v1/scenarios.json", import.meta.url)));
const tasks = JSON.parse(readFileSync(new URL("../evals/wave-agent/v1/tasks.json", import.meta.url)));
test("public corpus has distinct bilingual families and covers all 24 tools", () => {
  assert.equal(validateSources(source, tasks).tools.length, 24);
});
test("rejects a family moved across splits even when wording is changed", () => {
  const bad = globalThis.structuredClone(source); bad.find((s) => s.language === "en").split = "dev";
  assert.throws(() => validateSources(bad, tasks), /Family crosses splits/);
});
test("detects exact and close public prompt reuse", () => {
  const bad = globalThis.structuredClone(source); bad[0].turns[0].user = tasks[0].prompt;
  assert.throws(() => validateSources(bad, tasks), /evaluation overlap/);
  assert(nearDuplicate("Please keep all the current songs in this queue and add one track", "Please keep all the current songs in this queue and add two tracks"));
});
test("rejects reserved holdout families and prompts", () => {
  assert.throws(() => validateSources(source, tasks, { familyHashes: [hash(source[0].family)], promptHashes: [] }), /Reserved holdout family/);
  assert.throws(() => validateSources(source, tasks, { familyHashes: [], promptHashes: [hash(normalized(source[0].turns[0].user))] }), /Reserved holdout prompt/);
  assert.throws(() => validateSources(source, tasks, { familyHashes: [], promptHashes: [], promptGramHashes: [promptSignature(source[0].turns[0].user + " please")] }), /Near-duplicate holdout/);
});
test("holdout grading grounds references from receipts and keeps text review mandatory", () => {
  const decision = { type: "tool", name: "wave_play", args: { trackId: "observed" } };
  const targets = [{ id: "a", family: "test", language: "en", critical: true, rubric: "Correct track", decision },
    { id: "b", family: "test", language: "en", critical: true, rubric: "No false success", decision: { type: "answer", message: "playing" } }];
  const messages = [{ role: "user", content: JSON.stringify({ type: "tool_result", result: { ok: true, data: { tracks: [{ id: "observed", title: "Test", playable: true }] } } }) }];
  const evaluation = holdoutTasks(targets, [{ id: "a", messages }, { id: "b", messages }]);
  const score = scoreSubmissions(evaluation, targets);
  assert.equal(score.matched, 2); assert.deepEqual(score.manualReviewIds, ["b"]);
  assert.equal(scoreSubmissions(evaluation, [targets[0], targets[0]]).automatedPassed, false);
  assert.equal(scoreSubmissions(holdoutTasks(targets, [{ id: "a", messages: [] }, { id: "b", messages }]), targets).rows[0].reason, "unknown_reference");
});
test("rejects an invented target ID even when the command schema is valid", () => {
  const sample = { id: "x", prompt: [{ role: "system", content: "rules" }, { role: "user", content: JSON.stringify({ type: "user_request", text: "play" }) }],
    completion: [{ role: "assistant", content: JSON.stringify({ decision: { type: "tool", name: "wave_play", args: { trackId: "invented" } } }) }] };
  assert.throws(() => validateSamples([sample]), /unobserved ID/);
});
test("CLI refuses private sources on the training export path", () => {
  assert.throws(() => execFileSync(process.execPath, ["scripts/agent-data.mjs", "export", "--source", "/tmp/private.json", "--out", "/tmp/unused-wave-export"], { stdio: "pipe" }), /Command failed/);
});
test("CLI refuses a holdout stored in the repository", () => {
  assert.throws(() => execFileSync(process.execPath, ["scripts/agent-data.mjs", "seal", "--source", "training/wave-agent/v1/scenarios.json", "--out", "/tmp/unused-wave-holdout"], { stdio: "pipe" }), (error) => error.stderr.toString().includes("outside the repository"));
});
test("artifact verification detects tampering and refuses unsafe manifest paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-data-verify-"));
  try {
    const files = Object.fromEntries(["train.jsonl", "dev.jsonl", "index.jsonl", "traces.jsonl"].map((f) => {
      writeFileSync(join(dir, f), "[]\n"); return [f, hash("[]\n")];
    }));
    const manifest = { kind: "training-development", files };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const run = () => execFileSync(process.execPath, ["scripts/agent-data.mjs", "verify", "--bundle", dir], { stdio: "pipe" });
    assert(JSON.parse(run()).verified);
    writeFileSync(join(dir, "train.jsonl"), "tampered");
    assert.throws(run, (error) => error.stderr.toString().includes("hash mismatch"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ kind: "training-development", files: { "../outside": "fake" } }));
    assert.throws(run, (error) => error.stderr.toString().includes("hash mismatch"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("export never overwrites an existing directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-data-existing-"));
  try {
    assert.throws(() => execFileSync(process.execPath, ["scripts/agent-data.mjs", "export", "--out", dir], { stdio: "pipe" }), (error) => error.stderr.toString().includes("refusing to overwrite"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("ordinary validation ignores inherited private-source and export environment", () => {
  execFileSync(process.execPath, ["scripts/agent-data.mjs", "validate"], { stdio: "pipe", env: { ...process.env,
    WAVE_AGENT_DATA_SOURCE: "/missing-private-source.json", WAVE_AGENT_DATA_OUT: "/missing-parent/export", WAVE_AGENT_DATA_HOLDOUT: "1" } });
});
