import type { HlsPlaybackMode } from "../core/player/hlsPlayback";

interface ToolCheck {
  path: string | null;
  ready: boolean;
}

export interface DiagnosticsData {
  appVersion: string;
  platform: string;
  arch: string;
  android: boolean;
  appDataDir: string;
  toolsDir: string;
  dbPath: string | null;
  dbSize: number | null;
  ytdlp: ToolCheck;
  ffmpeg: ToolCheck;
  network: boolean;
}

export function buildDiagnosticReport(
  data: DiagnosticsData | null,
  logs: readonly { time: number; message: string }[],
  revision: string,
  hlsPlayback: HlsPlaybackMode | null,
) {
  // Free-form provider and plugin messages may contain paths, account names or credentials.
  const timing = /^Playback (?:youtube|soundcloud|local): (?:playing|failed|cancelled), \d+ms \((?:(?:resolve|validate|load|play)=\d+ms ?)*\)$/;
  return {
    app: "wave",
    at: new Date().toISOString(),
    revision: /^[a-f0-9]{7,40}$/i.test(revision) ? revision : null,
    hlsPlayback,
    diagnostics: data && {
      appVersion: data.appVersion, platform: data.platform, arch: data.arch, android: data.android,
      dbSize: data.dbSize, ytDlpReady: data.ytdlp.ready, ffmpegReady: data.ffmpeg.ready, network: data.network,
    },
    playbackTimings: logs.filter(({ message }) => timing.test(message)).slice(-200),
  };
}
