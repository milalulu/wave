import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = join(root, "node_modules/vite/bin/vite.js");
const temporary = mkdtempSync(join(tmpdir(), "wave-agent-bundles-"));
try {
  for (const platform of ["linux", "android", "androideabi", "browser"]) {
    const output = join(temporary, platform);
    const env = { ...process.env };
    if (platform === "browser") delete env.TAURI_ENV_PLATFORM;
    else env.TAURI_ENV_PLATFORM = platform;
    execFileSync(process.execPath, [vite, "build", "--outDir", output, "--emptyOutDir"], { cwd: root, env, stdio: "pipe" });
    const assets = join(output, "assets");
    const js = readdirSync(assets).filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(assets, file), "utf8")).join("\n");
    assert.equal(js.includes("wave_playlist_create"), platform === "linux", `${platform}: unexpected agent inclusion`);
    for (const marker of ["agent_model_complete", "agent_key_save", "wave:desktop-agent:v1"]) {
      assert.equal(js.includes(marker), platform === "linux", `${platform}: unexpected model/chat inclusion (${marker})`);
    }
    const css = readdirSync(assets).filter((file) => file.endsWith(".css")).map((file) => readFileSync(join(assets, file), "utf8")).join("\n");
    assert.equal(css.includes(".agent-view"), platform === "linux", `${platform}: unexpected agent UI styles`);
    assert.equal(js.includes("metadata-injection-ru"), false, `${platform}: benchmark data leaked into application`);
    console.log(`${platform}: agent ${platform === "linux" ? "included lazily" : "excluded"}, benchmark excluded`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
