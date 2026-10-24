import { defineConfig } from "vitest/config";

// Explicit opt-in only. Normal CI tests never contact a model server.
export default defineConfig({ test: { include: ["evals/wave-agent/scenarios.test.ts"], environment: "node",
  fileParallelism: false, maxWorkers: 1, testTimeout: 210000, hookTimeout: 30000 } });
