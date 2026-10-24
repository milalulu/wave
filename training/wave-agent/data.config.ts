import { defineConfig } from "vitest/config";

// Offline teacher replay only: no local model, network, native app or user database.
export default defineConfig({ test: { include: ["training/wave-agent/replay.test.ts"], environment: "node",
  fileParallelism: false, maxWorkers: 1, testTimeout: 30000 } });
