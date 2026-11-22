import { expect, it } from "vitest";
import { buildDiagnosticReport } from "./diagnosticReport";

it("copies a build revision and structured timings without local paths or signed URLs", () => {
  const path = "C:\\Users\\Private\\Music";
  const report = buildDiagnosticReport({
    appVersion: "1.0.0", platform: "windows", arch: "x86_64", android: false,
    appDataDir: path, toolsDir: path, dbPath: path, dbSize: 42, network: true,
    ytdlp: { path, ready: true }, ffmpeg: { path: null, ready: false },
  }, [
    { time: 1, message: "Playback youtube: playing, 250ms (resolve=200ms play=50ms)" },
    { time: 2, message: "Plugin bridge: https://example.org/sound?token=Secret" },
    { time: 3, message: "Playback local: playing, 250ms (resolve=200ms /home/private)" },
  ], "abcdef123");
  expect(report.revision).toBe("abcdef123");
  expect(report.playbackTimings).toHaveLength(1);
  expect(JSON.stringify(report)).not.toMatch(/Private|Secret|private|example\.org/);
});
