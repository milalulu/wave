import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { hash, normalized, validateSources, holdoutTasks, promptSignature } from "./agent-data-lib.mjs";
import { scoreSubmissions } from "../src/core/agent/evaluation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicSource = join(root, "training/wave-agent/v1/scenarios.json");
const tasks = JSON.parse(readFileSync(join(root, "evals/wave-agent/v1/tasks.json")));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const lines = (path) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s));
function outsideRepository(path) {
  const canonical = existsSync(path) ? realpathSync(path) : join(realpathSync(dirname(path)), path.split(/[\\/]/).at(-1));
  const rel = relative(realpathSync(root), canonical);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Holdout must stay outside the repository");
}
function verify(path) {
  const manifest = json(join(path, "manifest.json"));
  const allowed = ["inputs.jsonl", "targets.jsonl", "scenarios.json", "train.jsonl", "dev.jsonl", "index.jsonl", "traces.jsonl"];
  if (!manifest.files || !Object.keys(manifest.files).length) throw new Error("Missing file hashes");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!allowed.includes(name) || hash(readFileSync(join(path, name))) !== expected) throw new Error(`Artifact hash mismatch: ${name}`);
  }
  const required = manifest.kind === "sealed-holdout" ? ["inputs.jsonl", "targets.jsonl", "scenarios.json", "traces.jsonl"]
    : manifest.kind === "training-development" ? ["train.jsonl", "dev.jsonl", "index.jsonl", "traces.jsonl"] : [];
  if (!required.length || required.some((name) => !manifest.files[name])) throw new Error("Incomplete manifest");
  return manifest;
}

try {
  const [command = "validate", ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--out", "--source", "--bundle", "--responses"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid arguments");
    options[args[i]] = resolve(args[i + 1]);
  }
  const allowed = { validate: [], export: ["--out"], seal: ["--source", "--out"], verify: ["--bundle"], score: ["--bundle", "--responses"] }[command];
  if (!allowed || allowed.some((k) => !options[k]) || Object.keys(options).some((k) => !allowed.includes(k))) {
    throw new Error("Usage: agent-data.mjs validate | export --out NEW_DIR | seal --source PRIVATE_JSON --out NEW_PRIVATE_DIR | verify --bundle DIR | score --bundle PRIVATE_DIR --responses JSONL");
  }
  if (command === "verify") console.log(JSON.stringify({ verified: true, ...verify(options["--bundle"]) }, null, 2));
  else if (command === "score") {
    const bundle = options["--bundle"]; outsideRepository(bundle);
    const manifest = verify(bundle);
    if (manifest.kind !== "sealed-holdout") throw new Error("A sealed holdout is required");
    const registry = json(join(root, "training/wave-agent/v1/holdout-registry.json"));
    if (registry.sourceSha256 !== manifest.sourceSha256 || registry.manifestSha256 !== hash(readFileSync(join(bundle, "manifest.json")))) throw new Error("Holdout differs from the committed registry");
    const targets = lines(join(bundle, "targets.jsonl"));
    const evaluation = holdoutTasks(targets, lines(join(bundle, "inputs.jsonl")));
    const report = scoreSubmissions(evaluation, lines(options["--responses"]));
    console.log(JSON.stringify({ ...report, sourceSha256: manifest.sourceSha256, closedLoopEvaluation: false,
      productionReady: false, note: "Teacher-prefix next-decision evaluation only. Review all manualReviewIds against private rubrics and traces; do not tune on holdout." }, null, 2));
    if (!report.automatedPassed) process.exitCode = 1;
  } else {
    const env = { ...process.env };
    // Never inherit a private source/output into ordinary training export or CI.
    for (const key of ["WAVE_AGENT_DATA_SOURCE", "WAVE_AGENT_DATA_OUT", "WAVE_AGENT_DATA_HOLDOUT"]) delete env[key];
    if (command === "seal") {
      outsideRepository(options["--source"]); outsideRepository(options["--out"]);
      const held = json(options["--source"]);
      if (!held.every((s) => s.split === "holdout")) throw new Error("Only holdout scenarios may be sealed");
      validateSources([...json(publicSource), ...held], tasks);
      env.WAVE_AGENT_DATA_SOURCE = options["--source"]; env.WAVE_AGENT_DATA_HOLDOUT = "1";
    }
    if (options["--out"]) {
      if (existsSync(options["--out"])) throw new Error("Output directory already exists; refusing to overwrite");
      env.WAVE_AGENT_DATA_OUT = options["--out"];
    }
    execFileSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "training/wave-agent/data.config.ts"], { cwd: root, env, stdio: "inherit" });
    if (command === "seal") {
      const held = json(options["--source"]);
      const registry = { version: "seed-v1", sourceSha256: hash(readFileSync(options["--source"])),
        manifestSha256: hash(readFileSync(join(options["--out"], "manifest.json"))),
        dialogues: held.length, familyHashes: [...new Set(held.map((s) => hash(s.family)))],
        promptHashes: held.flatMap((s) => s.turns.map((t) => hash(normalized(t.user)))),
        promptGramHashes: held.flatMap((s) => s.turns.map((t) => promptSignature(t.user))),
        note: "Commit only this registry. Hashes detect exact/lexical reuse, not semantic leakage; private source and labels stay outside Git." };
      writeFileSync(join(options["--out"], "registry.json"), JSON.stringify(registry, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
