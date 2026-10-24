import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import process from "node:process";
import { replay, resolveReferences, type Scenario } from "./replay";
import { hash, validateSources, validateSamples } from "../../scripts/agent-data-lib.mjs";

const source = process.env.WAVE_AGENT_DATA_SOURCE ?? "training/wave-agent/v1/scenarios.json";
const sourceBytes = await readFile(source);
const scenarios: Scenario[] = JSON.parse(sourceBytes.toString());
const tasks = JSON.parse(await readFile("evals/wave-agent/v1/tasks.json", "utf8"));
const holdout = process.env.WAVE_AGENT_DATA_HOLDOUT === "1";
const registryPath = "training/wave-agent/v1/holdout-registry.json";
let reserved: { familyHashes: string[]; promptHashes: string[]; promptGramHashes?: string[][] } | undefined;
try { reserved = JSON.parse(await readFile(registryPath, "utf8")); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !holdout) throw error;
}

it("validates all teacher trajectories against the real controller, executor and player", async () => {
  validateSources(scenarios, tasks, reserved, !holdout);
  expect(scenarios.every((s) => holdout ? s.split === "holdout" : s.split !== "holdout")).toBe(true);
  const results = [];
  for (const scenario of scenarios) results.push({ scenario, result: await replay(scenario) });
  const samples = results.flatMap((r) => r.result.samples);
  validateSamples(samples);
  // Stable references are generated from real random runtime IDs, not invented by the teacher.
  expect(await replay(scenarios[0])).toEqual(results[0].result);
  const output = process.env.WAVE_AGENT_DATA_OUT;
  if (!output) return;
  // Fresh private directory only. No partial corpus is written before all replays pass.
  await mkdir(output, { recursive: false, mode: 0o700 });
  const files: Record<string, string> = {};
  const lines = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join("\n") + "\n";
  const put = async (name: string, values: unknown[]) => {
    const body = lines(values); await writeFile(join(output, name), body, { flag: "wx", mode: 0o600 }); files[name] = hash(body);
  };
  if (holdout) {
    await put("inputs.jsonl", samples.map((s) => ({ id: s.id, messages: s.prompt })));
    await put("targets.jsonl", samples.map((s) => ({ id: s.id, dialogueId: s.dialogueId, family: s.family,
      language: s.language, critical: s.critical, rubric: s.rubric, decision: JSON.parse(s.completion[0].content).decision })));
    await writeFile(join(output, "scenarios.json"), sourceBytes, { flag: "wx", mode: 0o600 }); files["scenarios.json"] = hash(sourceBytes);
  } else {
    for (const split of ["train", "dev"]) await put(`${split}.jsonl`, samples.filter((s) => s.split === split)
      .map((s) => ({ prompt: s.prompt, completion: s.completion })));
    await put("index.jsonl", samples.map(({ prompt: _p, completion: _c, ...metadata }) => metadata));
  }
  await put("traces.jsonl", results.map(({ scenario, result }) => ({ id: scenario.id, trace: result.trace })));
const sourceFiles = ["training/wave-agent/replay.ts", "training/wave-agent/replay.test.ts", "scripts/agent-data-lib.mjs", "scripts/agent-data.mjs",
    "src/core/agent/protocol.ts", "src/core/agent/catalog.ts", "src/core/agent/AgentConversation.ts", "src/core/agent/WaveAgentTools.ts"];
  const codeHashes: Record<string, string> = {};
  for (const path of sourceFiles) codeHashes[path] = hash(await readFile(path));
  const manifest = { version: "seed-v1", kind: holdout ? "sealed-holdout" : "training-development", sourceSha256: hash(sourceBytes),
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), codeHashes, files,
    dialogues: scenarios.length, samples: samples.length,
    splits: Object.fromEntries([...new Set(scenarios.map((s) => s.split))].map((split) => [split, {
      dialogues: scenarios.filter((s) => s.split === split).length, samples: samples.filter((s) => s.split === split).length,
      families: [...new Set(scenarios.filter((s) => s.split === split).map((s) => s.family))].length }])),
    provenance: "Original synthetic scenarios authored by Codex for this repository; no user library or third-party teacher API.",
    review: "Executable receipts and state assertions checked; text and intent reviewed by the same author, not independently certified.",
    trainingCompleted: false, closedLoopModelEvaluation: false,
    lossPolicy: "Train only on completion tokens. Prompt includes earlier assistant decisions and tool results; mask all prompt tokens.",
    limitations: "Small seed corpus. Family separation and lexical checks cannot prove semantic independence. Holdout prefixes use teacher receipts, not model-generated trajectories." };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Validated ${scenarios.length} dialogues / ${samples.length} decisions; exported to ${resolve(output)}`);
});

it("rejects references that were never observed", () => {
  expect(() => resolveReferences({ trackId: { $ref: "missing.data.id" } }, {})).toThrow("Missing receipt");
});

it("detects an incorrect state oracle instead of exporting a plausible narrative", async () => {
  const wrong = structuredClone(scenarios[0]); wrong.turns[0].expect.volume = -1;
  await expect(replay(wrong)).rejects.toThrow("volume");
});

it("rejects continuation after a failed tool in the same turn", () => {
  const wrong = structuredClone(scenarios);
  wrong[0].turns[0].steps = [{ name: "wave_search", args: { query: "x", limit: 1 }, as: "x", error: "provider_unavailable" }, { type: "answer", message: "done" }];
  expect(() => validateSources(wrong, tasks, reserved, false)).toThrow("Tool error must end");
});
