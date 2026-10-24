import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { localHost, modelMessages, ollamaMemory, parseDecision, requestJson, SCREEN_IDS, serviceResources } from "./agent-benchmark-lib.mjs";

test("model inputs exclude expected decisions, rubric, evaluation IDs and other fields", () => {
  const task = { id: "hidden-id", prompt: "pause", context: { tracks: [] }, expected: ["gold-answer"], rubric: "secret-rubric", extra: "secret-extra" };
  const messages = modelMessages(task);
  assert.equal(messages.length, 2);
  assert.deepEqual(JSON.parse(messages[1].content), { type: "user_request", text: "pause", context: { tracks: [] } });
  assert.doesNotMatch(JSON.stringify(messages), /hidden-id|gold-answer|secret-rubric|secret-extra/);
});
test("rejects remote endpoints, credentials and paths", () => {
  for (const host of ["https://127.0.0.1", "http://example.com", "http://localhost", "http://127.0.0.1/v1", "http://127.0.0.1?key=x", "http://key@127.0.0.1"]) assert.throws(() => localHost(host));
  assert.equal(localHost("http://[::1]:11434/"), "http://[::1]:11434");
});
test("truncated JSON cannot receive a passing score; raw evidence remains", () => {
  const raw = '{"type":"tool","name":"wave_pause","args":{}}';
  assert.equal(parseDecision({ done: true, done_reason: "length", message: { content: raw } }).decision, null);
  assert.equal(parseDecision({ done: true, done_reason: "stop", message: { content: raw } }).decision.name, "wave_pause");
  const invalid = parseDecision({ done: true, done_reason: "stop", message: { content: '{"name":"made_up"}' } });
  assert.equal(invalid.parseError, "invalid_decision"); assert.equal(invalid.raw, '{"name":"made_up"}');
});
test("RSS includes descendants, excludes other processes and reports unavailable as null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wave-proc-test-"));
  try {
    for (const [pid, name, ppid, rss] of [[1, "ollama", 0, 1024], [2, "runner", 1, 2048], [3, "worker", 2, 512], [4, "unrelated", 0, 8192]]) {
      await mkdir(join(dir, String(pid)));
      await writeFile(join(dir, String(pid), "status"), `Name:\t${name}\nPPid:\t${ppid}\nVmRSS:\t${rss} kB\nVmSwap:\t0 kB\n`);
    }
    assert.deepEqual(await ollamaMemory(dir), { processCount: 3, rssMiB: 3.5, swapMiB: 0 });
    assert.equal(await ollamaMemory(join(dir, "absent")), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function fixture(fn) {
  const server = createServer(fn);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { host: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
test("cgroup metrics distinguish anonymous memory, cache, swap and CPU usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wave-cgroup-test-"));
  try {
    await Promise.all(Object.entries({ "memory.current": "4194304", "memory.swap.current": "524288",
      "memory.stat": "anon 1048576\nfile 3145728\nfile_mapped 2097152\n", "cpu.stat": "usage_usec 1200000\n" })
      .map(([name, value]) => writeFile(join(dir, name), value)));
    assert.deepEqual(await serviceResources(dir), { totalMiB: 4, swapMiB: .5, anonymousMiB: 1,
      mappedFileMiB: 2, fileCacheMiB: 3, cpuUsageUsec: 1200000 });
    assert.equal(await serviceResources(join(dir, "absent")), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("transport bounds response bytes, rejects redirects, times out and sanitizes errors", async () => {
  const server = await fixture((req, res) => {
    if (req.url === "/redirect") { res.writeHead(307, { location: "/private" }); res.end(); }
    else if (req.url === "/large") { res.writeHead(200); res.end('"' + "x".repeat(2000) + '"'); }
    else if (req.url === "/error") { res.writeHead(500); res.end("private-key"); }
  });
  try {
    await assert.rejects(requestJson(server.host, "/redirect"), /transport_error/);
    await assert.rejects(requestJson(server.host, "/large", undefined, { limit: 100 }), /response_too_large/);
    await assert.rejects(requestJson(server.host, "/error"), /HTTP_500/);
    await assert.rejects(requestJson(server.host, "/hang", undefined, { timeoutMs: 30 }), /timeout/);
  } finally { await server.close(); }
});

for (const mode of ["complete", "timeout", "busy"]) test(`CLI ${mode}: preserves evidence, respects loaded models and cleans up its own model`, async () => {
  let loaded = mode === "busy";
  let calls = 0;
  const server = await fixture(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk.toString());
    const body = chunks.length ? JSON.parse(chunks.join("")) : null;
    let value;
    if (req.url === "/api/ps") value = { models: loaded ? [{ name: "fixture:1b", size: 123, size_vram: 0, context_length: 8192 }] : [] };
    else if (req.url === "/api/tags") value = { models: [{ name: "fixture:1b", digest: "fixture-digest", size: 123, details: { format: "gguf" } }] };
    else if (req.url === "/api/show") value = { template: "fixture", license: "" };
    else if (req.url === "/api/version") value = { version: "fixture" };
    else if (req.url === "/api/chat" && body.keep_alive === 0) { loaded = false; value = { done: true }; }
    else {
      calls++; loaded = true;
      if (mode === "timeout") return;
      assert.equal(body.options.num_gpu, 0); assert.equal(body.think, false);
      assert.doesNotMatch(JSON.stringify(body.messages), /"expected"|"rubric"/);
      value = { done: true, done_reason: "stop", message: { content: '{"type":"tool","name":"wave_pause","args":{}}' } };
    }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value));
  });
  const temp = await mkdtemp(join(tmpdir(), "wave-benchmark-test-"));
  const out = join(temp, "results");
  try {
    const script = fileURLToPath(new URL("./agent-benchmark.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, "run", "--host", server.host, "--model", "fixture:1b", "--out", out, "--suite", "screen",
      "--timeout-ms", mode === "timeout" ? "100" : "60000"]);
    let error = ""; child.stderr.on("data", (s) => { error += s; }); child.stdout.resume();
    const code = await new Promise((r) => child.on("exit", r));
    assert.equal(code, mode === "complete" ? 0 : 1, error);
    if (mode === "busy") {
      assert.equal(calls, 0); assert.equal(loaded, true);
      await assert.rejects(readFile(join(out, "manifest.json")), { code: "ENOENT" });
      return;
    }
    assert.equal(calls, mode === "complete" ? SCREEN_IDS.length : 1); assert.equal(loaded, false);
    const report = JSON.parse(await readFile(join(out, "score.json"), "utf8"));
    assert.equal(report.total, SCREEN_IDS.length); assert.equal(report.scope, "screen");
    assert.equal(report.suiteComplete, mode === "complete"); assert.equal(report.productionReady, false);
    assert.equal(report.matched, mode === "complete" ? 1 : 0);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    assert.equal(manifest.modelUnloadConfirmed, true); assert.equal(manifest.status, mode === "complete" ? "complete" : "partial");
    if (mode === "timeout") {
      assert.equal(report.missing, SCREEN_IDS.length - 1);
      const sample = JSON.parse((await readFile(join(out, "samples.jsonl"), "utf8")).trim());
      assert.equal(sample.error, "timeout"); assert.equal(sample.decision, null);
    }
  } finally { await server.close(); await rm(temp, { recursive: true, force: true }); }
});
