import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { RefreshCwIcon, TrashIcon } from "./icons";

interface ToolCheck {
  path: string | null;
  ready: boolean;
}

interface DiagnosticsData {
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

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function Status({ ok }: { ok: boolean }) {
  return <span className={ok ? "diag-ok" : "diag-bad"}>{ok ? "✓" : "✗"}</span>;
}

export function DiagnosticsView() {
  const { t } = useI18n();
  const logs = useApp((s) => s.logs);
  const clearLogs = useApp((s) => s.clearLogs);
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      setData(await invoke<DiagnosticsData>("diagnostics"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const platformLabel = data?.android ? t("settings").diagAndroid : data?.platform ?? "";

  return (
    <div className="settings-cards diag-cards">
      <section className="settings-card settings-card-wide diag-card">
        <h2>{t("settings").diagPlatform}</h2>
        <p className="muted">
          Wave {data?.appVersion ?? "…"} · {platformLabel} · {data?.arch ?? "…"}
        </p>
        <button className="btn" onClick={() => void run()} disabled={busy}>
          <RefreshCwIcon size={16} /> {busy ? "…" : t("settings").diagRefresh}
        </button>
        {error && <p className="diag-bad">{error}</p>}
      </section>

      {data && (
        <>
          <section className="settings-card diag-card">
            <h2>{t("settings").diagNetwork}</h2>
            <div className="diag-row">
              <span className="diag-key">{t("settings").diagNetwork}</span>
              <span className="diag-val">
                <Status ok={data.network} />
              </span>
            </div>
          </section>

          <section className="settings-card diag-card">
            <h2>{t("settings").diagTools}</h2>
            <div className="diag-row">
              <span className="diag-key">yt-dlp</span>
              <span className="diag-val">
                <Status ok={data.ytdlp.ready} />
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">{t("settings").diagPath}</span>
              <span className="diag-val">{data.ytdlp.path ?? "—"}</span>
            </div>
            <div className="diag-row">
              <span className="diag-key">ffmpeg</span>
              <span className="diag-val">
                <Status ok={data.ffmpeg.ready} />
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">{t("settings").diagPath}</span>
              <span className="diag-val">{data.ffmpeg.path ?? "—"}</span>
            </div>
          </section>

          <section className="settings-card settings-card-wide diag-card">
            <h2>{t("settings").diagStorage}</h2>
            <div className="diag-row">
              <span className="diag-key">{t("settings").diagDatabase}</span>
              <span className="diag-val">
                {data.dbPath
                  ? `${data.dbPath}${data.dbSize != null ? ` (${t("settings").diagSize(data.dbSize)})` : ""}`
                  : "—"}
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-key">appDataDir</span>
              <span className="diag-val">{data.appDataDir}</span>
            </div>
            <div className="diag-row">
              <span className="diag-key">toolsDir</span>
              <span className="diag-val">{data.toolsDir}</span>
            </div>
          </section>
        </>
      )}

      <section className="settings-card settings-card-wide diag-card">
        <h2>{t("settings").diagLogs}</h2>
        <div className="settings-action-row">
          <button className="btn" onClick={clearLogs} disabled={logs.length === 0}>
            <TrashIcon size={16} /> {t("settings").diagClearLogs}
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="muted">{t("settings").diagNoLogs}</p>
        ) : (
          <div className="diag-log">
            {logs
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i}>
                  [{fmtTime(e.time)}] {e.message}
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
