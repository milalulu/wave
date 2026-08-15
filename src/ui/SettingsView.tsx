import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import {
  FolderIcon,
  SaveIcon,
  RefreshCwIcon,
  DownloadIcon,
  UploadIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "./icons";
import { open, save } from "@tauri-apps/plugin-dialog";
import { loadYtQuality, saveYtQuality, type YtQuality } from "../app/ytQuality";
import { CROSSFADE_OPTIONS } from "../app/crossfade";
import {
  KNOWN_PROVIDERS,
  getBlockedProviders,
  getPreferredProviders,
  setBlockedProviders,
  setPreferredProviders,
} from "../app/platformSettings";
import { providerLabel } from "./providers";
import { DiagnosticsView } from "./DiagnosticsView";

interface AppConfigResult {
  ytdlpPath?: string | null;
  ytdlpCookies?: string | null;
  soundcloudClientId?: string | null;
  spotifyClientId?: string | null;
  spotifyClientSecret?: string | null;
  vkToken?: string | null;
  lastfmApiKey?: string | null;
  lastfmApiSecret?: string | null;
  lastfmSessionKey?: string | null;
  lastfmScrobbleEnabled?: boolean;
}

interface ToolsStatus {
  ytdlpPath?: string | null;
  ytdlpReady: boolean;
  ffmpegPath?: string | null;
  ffmpegReady: boolean;
}

const ENV_KEYS = [
  "WAVE_YTDLP_PATH",
  "WAVE_YTDLP_COOKIES",
  "WAVE_SOUNDCLOUD_CLIENT_ID",
  "WAVE_SPOTIFY_CLIENT_ID",
  "WAVE_SPOTIFY_CLIENT_SECRET",
  "WAVE_VK_TOKEN",
  "WAVE_LASTFM_API_KEY",
  "WAVE_LASTFM_API_SECRET",
  "WAVE_LASTFM_SESSION_KEY",
] as const;

function fromRust(cfg: AppConfigResult): Record<string, string> {
  const map: Record<string, string> = {
    WAVE_YTDLP_PATH: cfg.ytdlpPath ?? "",
    WAVE_YTDLP_COOKIES: cfg.ytdlpCookies ?? "",
    WAVE_SOUNDCLOUD_CLIENT_ID: cfg.soundcloudClientId ?? "",
    WAVE_SPOTIFY_CLIENT_ID: cfg.spotifyClientId ?? "",
    WAVE_SPOTIFY_CLIENT_SECRET: cfg.spotifyClientSecret ?? "",
    WAVE_VK_TOKEN: cfg.vkToken ?? "",
    WAVE_LASTFM_API_KEY: cfg.lastfmApiKey ?? "",
    WAVE_LASTFM_API_SECRET: cfg.lastfmApiSecret ?? "",
    WAVE_LASTFM_SESSION_KEY: cfg.lastfmSessionKey ?? "",
    WAVE_LASTFM_SCROBBLE_ENABLED: cfg.lastfmScrobbleEnabled ? "1" : "0",
  };
  return map;
}

function SettingsCard({ title, desc, children, wide }: { title: string; desc?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`settings-card ${wide ? "settings-card-wide" : ""}`}>
      <h2>{title}</h2>
      {desc && <p className="muted">{desc}</p>}
      {children}
    </section>
  );
}

export function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const services = useApp((s) => s.services);
  const notify = useApp((s) => s.notify);
  const accentEnabled = useApp((s) => s.accentEnabled);
  const setAccentEnabled = useApp((s) => s.setAccentEnabled);
  const autoContinue = useApp((s) => s.autoContinue);
  const setAutoContinue = useApp((s) => s.setAutoContinue);
  const offlineMode = useApp((s) => s.offlineMode);
  const setOfflineMode = useApp((s) => s.setOfflineMode);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const lyricsAutoOpen = useApp((s) => s.lyricsAutoOpen);
  const setLyricsAutoOpen = useApp((s) => s.setLyricsAutoOpen);
  const lyricsAutoscroll = useApp((s) => s.lyricsAutoscroll);
  const setLyricsAutoscroll = useApp((s) => s.setLyricsAutoscroll);
  const crossfadeMs = useApp((s) => s.crossfadeMs);
  const setCrossfadeMs = useApp((s) => s.setCrossfadeMs);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [localDir, setLocalDir] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [ytQuality, setYtQuality] = useState<YtQuality>(loadYtQuality());
  const [blocked, setBlocked] = useState<string[]>(() => getBlockedProviders());
  const [preferred, setPreferred] = useState<string[]>(() => {
    const saved = getPreferredProviders();
    const all = KNOWN_PROVIDERS.map((p) => p);
    const merged = [...saved, ...all.filter((id) => !saved.includes(id))];
    return merged;
  });
  const clearCaches = useApp((s) => s.clearCaches);
  const [testingAll, setTestingAll] = useState(false);
  const [allResults, setAllResults] = useState<Record<string, string>>({});
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [tab, setTab] = useState<"main" | "diagnostics">("main");

  const loadTools = async (): Promise<void> => {
    try {
      setTools(await invoke<ToolsStatus>("tools_status"));
    } catch {
      setTools(null);
    }
  };
  useEffect(() => {
    void loadTools();
  }, []);

  const testAllProviders = async (): Promise<void> => {
    if (!services) return;
    setTestingAll(true);
    setAllResults({});
    const entries = services.providers.map(async (p) => {
      try {
        const res = await p.search("test");
        const ok = (res.tracks?.length ?? 0) >= 0;
        return { id: p.id, text: ok ? "✓ OK" : "✗" };
      } catch (e) {
        return { id: p.id, text: `✗ ${e instanceof Error ? e.message : String(e)}`.slice(0, 60) };
      }
    });
    const settled = await Promise.allSettled(entries);
    const next: Record<string, string> = {};
    for (const r of settled) {
      if (r.status === "fulfilled") next[r.value.id] = r.value.text;
    }
    setAllResults(next);
    setTestingAll(false);
  };

  const movePreferred = (index: number, dir: -1 | 1) => {
    setPreferred((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<AppConfigResult>("app_config");
      setConfig(fromRust(cfg));
      const dir = localStorage.getItem("wave-local-dir");
      if (dir) setLocalDir(dir);
    } catch {
      /* конфиг недоступен — оставим пустые поля */
    }
  };

  const saveConfig = async () => {
    const payload: Record<string, string> = {};
    for (const key of ENV_KEYS) {
      const v = (config[key] ?? "").trim();
      if (v) payload[key] = v;
    }
    payload["WAVE_LASTFM_SCROBBLE_ENABLED"] =
      config["WAVE_LASTFM_SCROBBLE_ENABLED"] === "1" ? "1" : "0";
    setBlockedProviders(blocked);
    setPreferredProviders(preferred);
    try {
      await invoke("save_app_config", { config: payload });
      localStorage.setItem("wave-local-dir", localDir);
      await useApp.getState().reloadServices();
      notify(t("toasts").settingsSaved);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTest = async (key: string) => {
    if (!services) return;
    setTesting(key);
    setTestResults((prev) => ({ ...prev, [key]: t("common").loading }));
    try {
      const providers = services.providers.filter((p) => {
        if (key === "WAVE_YTDLP_PATH") return p.id === "youtube";
        if (key === "WAVE_SOUNDCLOUD_CLIENT_ID") return p.id === "soundcloud";
        if (key === "WAVE_SPOTIFY_CLIENT_ID") return p.id === "spotify";
        if (key === "WAVE_VK_TOKEN") return p.id === "vk";
        if (key === "WAVE_LASTFM_API_KEY") return p.id === "lastfm";
        return false;
      });
      if (providers.length === 0) {
        setTestResults((prev) => ({ ...prev, [key]: t("settings").providerNotLoaded }));
        return;
      }
      const results = await Promise.allSettled(providers.map((p) => p.search("test")));
      const ok = results.some((r) => r.status === "fulfilled");
      if (ok) {
        setTestResults((prev) => ({ ...prev, [key]: t("settings").testOK }));
      } else {
        const reasons = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
        setTestResults((prev) => ({
          ...prev,
          [key]: `${t("settings").testFailed} ${reasons[0] ?? ""}`.trim(),
        }));
      }
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [key]: `${t("settings").testFailed} ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setTesting(null);
    }
  };

  const pickLocalDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === "string") {
      setLocalDir(dir);
    }
  };

  const handleDetect = async (key: string) => {
    setTesting(key);
    setTestResults((prev) => ({ ...prev, [key]: t("common").loading }));
    try {
      const path = await invoke<string | null>("tools_detect");
      if (path) {
        setConfig((c) => ({ ...c, [key]: path }));
        setTestResults((prev) => ({ ...prev, [key]: t("settings").testOK }));
      } else {
        setTestResults((prev) => ({ ...prev, [key]: t("settings").providerNotLoaded }));
      }
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [key]: `${t("settings").testFailed} ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setTesting(null);
    }
  };

  const envKeys = [
    { key: "WAVE_YTDLP_PATH", label: "yt-dlp path", placeholder: "yt-dlp (or full path)", type: "text", test: true, detect: true },
    { key: "WAVE_YTDLP_COOKIES", label: "yt-dlp cookies", placeholder: "C:/path/to/cookies.txt or browser:chrome", type: "text" },
    { key: "WAVE_SOUNDCLOUD_CLIENT_ID", label: "SoundCloud Client ID", placeholder: "pJ6Fj6roW2KRzWAOwGj6kkQ8VRBJjyBD", type: "text", test: true },
    { key: "WAVE_SPOTIFY_CLIENT_ID", label: "Spotify Client ID", placeholder: "...", type: "text", test: true },
    { key: "WAVE_SPOTIFY_CLIENT_SECRET", label: "Spotify Client Secret", placeholder: "...", type: "password", test: false },
    { key: "WAVE_VK_TOKEN", label: "VK Token (user, scope=audio)", placeholder: "...", type: "password", test: true },
    { key: "WAVE_LASTFM_API_KEY", label: "Last.fm API Key", placeholder: "...", type: "text", test: true },
    { key: "WAVE_LASTFM_API_SECRET", label: "Last.fm API Secret", placeholder: "...", type: "password", test: false },
    { key: "WAVE_LASTFM_SESSION_KEY", label: "Last.fm Session Key", placeholder: "...", type: "password", test: false },
    { key: "WAVE_API_TOKEN", label: "HTTP API Token (empty = auto)", placeholder: "auto-generated", type: "password", test: false },
  ];

  return (
    <div className="view settings-view">
      <div className="settings-topbar">
        <h1>{t("settings").title}</h1>
        <div className="settings-topbar-actions">
          <div className="settings-seg" role="group" aria-label="settings">
            <button className={tab === "main" ? "active" : ""} onClick={() => setTab("main")}>
              {t("settings").title}
            </button>
            <button
              className={tab === "diagnostics" ? "active" : ""}
              onClick={() => setTab("diagnostics")}
            >
              {t("settings").diagnostics}
            </button>
          </div>
          {tab === "main" && (
            <>
              <div className="settings-seg" role="group" aria-label={t("settings").language}>
                <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} title={t("settings").language}>
                  English
                </button>
                <button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")} title={t("settings").language}>
                  Русский
                </button>
              </div>
              <div className="settings-seg" role="group" aria-label={t("settings").theme}>
                <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>
                  {t("settings").themeLight}
                </button>
                <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>
                  {t("settings").themeDark}
                </button>
              </div>
              <button className="btn btn-primary" onClick={saveConfig}>
                <SaveIcon size={16} /> {t("settings").save}
              </button>
              <button className="btn" onClick={loadConfig}>
                <RefreshCwIcon size={16} /> {t("settings").load}
              </button>
            </>
          )}
        </div>
      </div>

      {tab === "diagnostics" ? (
        <DiagnosticsView />
      ) : (
      <div className="settings-cards">
        <SettingsCard title={t("settings").apiKeys} desc={t("settings").apiKeysDesc} wide>
          <div className="settings-grid">
            {envKeys.map(({ key, label, placeholder, type, test, detect }) => (
              <div key={key} className="setting-row">
                <label htmlFor={key}>{label}</label>
                <div className="input-group">
                  <input
                    id={key}
                    type={type}
                    placeholder={placeholder}
                    value={config[key] || ""}
                    onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
                  />
                  {detect && (
                    <button
                      className="btn small"
                      onClick={() => handleDetect(key)}
                      disabled={testing === key}
                    >
                      {testing === key ? "..." : t("settings").detectYtDlp}
                    </button>
                  )}
                  {test && (
                    <button
                      className="btn small"
                      onClick={() => handleTest(key)}
                      disabled={testing === key}
                    >
                      {testing === key ? "..." : t("settings").test}
                    </button>
                  )}
                </div>
                {testResults[key] && <span className={`test-result ${testResults[key].startsWith("✓") ? "ok" : "err"}`}>{testResults[key]}</span>}
              </div>
            ))}
            <div className={`scrobble-status ${services?.scrobbler ? "ok" : ""}`}>
              {services?.scrobbler
                ? t("settings").lastfmStatusEnabled
                : t("settings").lastfmStatusDisabled}
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={config["WAVE_LASTFM_SCROBBLE_ENABLED"] === "1"}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    WAVE_LASTFM_SCROBBLE_ENABLED: e.target.checked ? "1" : "0",
                  }))
                }
              />
              <span>{t("settings").lastfmScrobbleToggle}</span>
            </label>
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").sources} desc={t("settings").sourcesDesc} wide>
          <div className="source-block">
            <h3>{t("settings").blockedProviders}</h3>
            <p className="muted">{t("settings").blockedProvidersDesc}</p>
            <div className="provider-chips">
              {KNOWN_PROVIDERS.map((id) => {
                const isBlocked = blocked.includes(id);
                return (
                  <button
                    key={id}
                    className={`chip ${isBlocked ? "blocked" : ""}`}
                    onClick={() =>
                      setBlocked((prev) =>
                        isBlocked ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  >
                    {providerLabel(id)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="source-block">
            <h3>{t("settings").preferredProviders}</h3>
            <p className="muted">{t("settings").preferredProvidersDesc}</p>
            <div className="preferred-list">
              {preferred.map((id, i) => (
                <div key={id} className={`preferred-item ${blocked.includes(id) ? "dim" : ""}`}>
                  <span className="preferred-label">{providerLabel(id)}</span>
                  <div className="preferred-actions">
                    <button
                      className="icon-btn"
                      disabled={i === 0}
                      onClick={() => movePreferred(i, -1)}
                      title={t("settings").moveUp}
                    >
                      <ChevronUpIcon size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === preferred.length - 1}
                      onClick={() => movePreferred(i, 1)}
                      title={t("settings").moveDown}
                    >
                      <ChevronDownIcon size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="source-actions">
            <button className="btn" onClick={clearCaches}>
              {t("settings").resetCaches}
            </button>
            <button className="btn" onClick={() => void testAllProviders()} disabled={testingAll}>
              {testingAll ? t("settings").testing : t("settings").testAll}
            </button>
          </div>
          {Object.keys(allResults).length > 0 && (
            <div className="provider-test-results">
              {Object.entries(allResults).map(([id, text]) => (
                <span key={id} className="provider-test-row">
                  <b>{providerLabel(id)}</b> {text}
                </span>
              ))}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={t("settings").behavior}>
          <div className="settings-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={accentEnabled}
                onChange={(e) => setAccentEnabled(e.target.checked)}
              />
              <span>{t("settings").accentFromCover}</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={autoContinue}
                onChange={(e) => setAutoContinue(e.target.checked)}
              />
              <span>{t("settings").autoContinue}</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={offlineMode}
                onChange={(e) => setOfflineMode(e.target.checked)}
              />
              <span>{t("settings").offlineMode}</span>
            </label>
          </div>
          <p className="muted">{t("settings").accentFromCoverDesc}</p>
          <p className="muted">{t("settings").autoContinueDesc}</p>
          <p className="muted">{t("settings").offlineModeDesc}</p>
        </SettingsCard>

        <SettingsCard title={t("settings").lyrics} desc={t("settings").lyricsDesc}>
          <div className="settings-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={lyricsAutoOpen}
                onChange={(e) => setLyricsAutoOpen(e.target.checked)}
              />
              <span>{t("settings").lyricsAutoOpen}</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={lyricsAutoscroll}
                onChange={(e) => setLyricsAutoscroll(e.target.checked)}
              />
              <span>{t("settings").lyricsAutoscroll}</span>
            </label>
          </div>
          <p className="muted">{t("settings").lyricsAutoOpenDesc}</p>
          <p className="muted">{t("settings").lyricsAutoscrollDesc}</p>
        </SettingsCard>

        <SettingsCard title={t("settings").crossfade} desc={t("settings").crossfadeDesc}>
          <div className="actions-row">
            {CROSSFADE_OPTIONS.map((ms) => (
              <button
                key={ms}
                className={`btn ${crossfadeMs === ms ? "btn-primary" : ""}`}
                onClick={() => setCrossfadeMs(ms)}
              >
                {ms === 0 ? t("settings").crossfadeOff : `${ms} ms`}
              </button>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").localFiles} desc={t("settings").localFilesDesc}>
          <div className="setting-row">
            <label htmlFor="local-dir">{t("settings").selectFolder}</label>
            <div className="input-group">
              <input
                id="local-dir"
                type="text"
                placeholder={t("settings").folderPlaceholder}
                value={localDir}
                readOnly
              />
              <button className="btn" onClick={pickLocalDir}>
                <FolderIcon size={18} /> {t("settings").choose}
              </button>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").ytQuality} desc={t("settings").ytQualityDesc}>
          <div className="actions-row">
            {(["low", "medium", "high", "best"] as YtQuality[]).map((q) => (
              <button
                key={q}
                className={`btn ${ytQuality === q ? "btn-primary" : ""}`}
                onClick={() => {
                  setYtQuality(q);
                  saveYtQuality(q);
                }}
              >
                {t("settings").ytQualityLabels[q]}
              </button>
            ))}
          </div>
          <div className="settings-action-row">
            <button
              className="btn"
              onClick={async () => {
                const result = await invoke("yt_update");
                notify(typeof result === "string" ? result : t("settings").updateYtDlpDesc);
              }}
            >
              <RefreshCwIcon size={16} /> {t("settings").updateYtDlp}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").tools} desc={t("settings").toolsDesc}>
          <div className="settings-action-row">
            <button
              className="btn"
              disabled={toolsBusy}
              onClick={async () => {
                setToolsBusy(true);
                try {
                  setTools(await invoke<ToolsStatus>("ensure_tools"));
                  notify(t("settings").toolsReady);
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                } finally {
                  setToolsBusy(false);
                }
              }}
            >
              <DownloadIcon size={16} />{" "}
              {toolsBusy ? t("settings").toolsDownloading : t("settings").toolsInstall}
            </button>
          </div>
          {tools && (
            <div className="muted tools-status">
              <div>
                yt-dlp: {tools.ytdlpReady ? t("settings").toolsReady : t("settings").toolsMissing} —{" "}
                {tools.ytdlpPath}
              </div>
              {tools.ffmpegPath && (
                <div>
                  ffmpeg: {tools.ffmpegReady ? t("settings").toolsReady : t("settings").toolsMissing} —{" "}
                  {tools.ffmpegPath}
                </div>
              )}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={t("settings").backup} desc={t("settings").backupDesc}>
          <div className="actions-row">
            <button
              className="btn"
              onClick={async () => {
                const path = await save({
                  defaultPath: "wave-backup.db",
                  filters: [{ name: "SQLite", extensions: ["db"] }],
                });
                if (!path) return;
                try {
                  await invoke("backup_database", { path });
                  notify(t("toasts").exportSuccess);
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <DownloadIcon size={18} /> {t("settings").backup}
            </button>
            <button
              className="btn"
              onClick={async () => {
                const path = await open({
                  filters: [{ name: "SQLite", extensions: ["db"] }],
                  multiple: false,
                });
                if (!path || typeof path !== "string") return;
                try {
                  await invoke("restore_database", { path });
                  notify(t("settings").restoreDesc);
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <UploadIcon size={18} /> {t("settings").restore}
            </button>
          </div>
        </SettingsCard>
      </div>
      )}
    </div>
  );
}
