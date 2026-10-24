import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { AGENT_TOOLS } from "../src/core/agent/catalog.ts";
import { AGENT_CONTRACT_VERSION } from "../src/core/agent/contract.ts";
import { AGENT_SYSTEM_PROMPT } from "../src/core/agent/prompt.ts";
import { gradeDecision, scoreSubmissions } from "../src/core/agent/evaluation.ts";

const tasks = JSON.parse(await readFile(new URL("../evals/wave-agent/v1/tasks.json", import.meta.url), "utf8"));

function validateTasks() {
  const ids = new Set();
  const covered = new Set();
  if (!Array.isArray(tasks) || !tasks.length) throw new Error("Empty benchmark");
  for (const task of tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`Missing or duplicate task ID: ${task.id}`);
    ids.add(task.id);
    if (!["ru", "en"].includes(task.language) || !task.category || typeof task.critical !== "boolean"
      || !task.prompt?.trim() || !task.rubric?.trim() || !task.context || !task.expected?.length) throw new Error(`Invalid task: ${task.id}`);
    for (const expected of task.expected) {
      const decision = expected.type === "tool" ? expected : { ...expected, message: "review required" };
      if (!gradeDecision(task, decision).matched) throw new Error(`Invalid reference decision: ${task.id}`);
      if (expected.type === "tool") covered.add(expected.name);
    }
  }
  const missing = Object.keys(AGENT_TOOLS).filter((name) => !covered.has(name));
  if (missing.length) throw new Error(`Untested tools: ${missing.join(", ")}`);
  if (new Set(tasks.map((t) => t.language)).size !== 2) throw new Error("Both languages are required");
}

function metrics(submissions) {
  const summarize = (key) => {
    const values = submissions.map((s) => s[key]).filter((v) => typeof v === "number").sort((a, b) => a - b);
    const percentile = (p) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
    return { samples: values.length, p50: percentile(0.5), p95: percentile(0.95), max: values.at(-1) ?? null };
  };
  return { latencyMs: summarize("latencyMs"), peakMemoryMiB: summarize("peakMemoryMiB") };
}

try {
  validateTasks();
  const [command = "validate", path] = process.argv.slice(2);
  if (command === "validate") {
    console.log(JSON.stringify({ contractVersion: AGENT_CONTRACT_VERSION, tools: Object.keys(AGENT_TOOLS).length, tasks: tasks.length, languages: ["ru", "en"] }, null, 2));
  } else if (command === "export") {
    // Never include reference decisions or grading rubrics in model inputs.
    for (const task of tasks) console.log(JSON.stringify({
      id: task.id, contractVersion: AGENT_CONTRACT_VERSION, system: AGENT_SYSTEM_PROMPT,
      tools: Object.entries(AGENT_TOOLS).map(([name, { description, parameters }]) => ({ name, description, parameters })),
      user: task.prompt, context: task.context,
    }));
  } else if (command === "score" && path) {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim());
    const submissions = lines.map((line, i) => {
      const s = JSON.parse(line);
      if (!s || typeof s.id !== "string" || !("decision" in s)) throw new Error(`Invalid submission at line ${i + 1}`);
      for (const key of ["latencyMs", "peakMemoryMiB"]) {
        if (s[key] !== undefined && (typeof s[key] !== "number" || !Number.isFinite(s[key]) || s[key] < 0)) throw new Error(`Invalid ${key} at line ${i + 1}`);
      }
      return s;
    });
    const report = scoreSubmissions(tasks, submissions);
    console.log(JSON.stringify({ contractVersion: AGENT_CONTRACT_VERSION, ...report,
      measured: metrics(submissions.filter((s) => tasks.some((t) => t.id === s.id) && !report.duplicateIds.includes(s.id))),
      note: "Routing/argument evaluation only. Review manualReviewIds using task rubrics; this does not verify execution or model suitability." }, null, 2));
    if (!report.automatedPassed) process.exitCode = 1;
  } else {
    throw new Error("Usage: node scripts/agent-eval.mjs validate|export|score <responses.jsonl>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
