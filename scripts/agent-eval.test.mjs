import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
const tasks = JSON.parse(readFileSync(new URL("../evals/wave-agent/v1/tasks.json", import.meta.url), "utf8"));

const script = fileURLToPath(new URL("./agent-eval.mjs", import.meta.url));

describe("agent evaluation CLI", () => {
  it("exports every task without reference answers or rubrics", () => {
    const rows = execFileSync(process.execPath, [script, "export"], { encoding: "utf8" }).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, tasks.length);
    assert.ok(rows.every((r) => r.tools.length === 24 && r.system && r.user));
    assert.ok(rows.every((r) => !("expected" in r) && !("rubric" in r)));
  });

  it("reports a complete reference routing run with outstanding manual review", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-agent-eval-"));
    try {
      const file = join(dir, "responses.jsonl");
      writeFileSync(file, tasks.map((task) => {
        const expected = task.expected[0];
        return JSON.stringify({ id: task.id, decision: expected.type === "tool" ? expected : { ...expected, message: "Synthetic test only" }, latencyMs: 10 });
      }).join("\n"));
      const report = JSON.parse(execFileSync(process.execPath, [script, "score", file], { encoding: "utf8" }));
      assert.equal(report.automatedPassed, true);
      assert.equal(report.matched, tasks.length);
      assert.ok(report.manualReviewIds.length > 0);
      assert.equal(report.measured.latencyMs.p95, 10);
      assert.equal(report.measured.peakMemoryMiB.samples, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("fails incomplete runs and invalid measurement input", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-agent-eval-"));
    try {
      const file = join(dir, "responses.jsonl");
      writeFileSync(file, "");
      const partial = spawnSync(process.execPath, [script, "score", file], { encoding: "utf8" });
      assert.equal(partial.status, 1);
      assert.equal(JSON.parse(partial.stdout).missing, tasks.length);
      writeFileSync(file, JSON.stringify({ id: "pause-ru", decision: { type: "tool", name: "wave_pause", args: {} }, latencyMs: -1 }));
      const invalid = spawnSync(process.execPath, [script, "score", file], { encoding: "utf8" });
      assert.equal(invalid.status, 1);
      assert.ok(invalid.stderr.includes("Invalid latencyMs"));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
