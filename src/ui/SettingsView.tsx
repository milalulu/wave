import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { notificationsEnabled, setNotificationsEnabled } from "../app/notifications";
import { FolderIcon, SaveIcon, RefreshCwIcon, DownloadIcon, UploadIcon } from "./icons";
import { open, save } from "@tauri-apps/plugin-dialog";

export function SettingsView() {
  const { t } = useI18n();
  const { services, notify } = useApp((s) => ({ services: s.services, notify: s.notify }));
  const accentEnabled = useApp((s) => s.accentEnabled);
  const setAccentEnabled = useApp((s) => s.setAccentEnabled);
  const [notificationsOn, setNotificationsOn] = useState(notificationsEnabled());
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [localDir, setLocalDir] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const saved = localStorage.getItem("wave-config");
      if (saved) {
        setConfig(JSON.parse(saved));
      }
      const dir = localStorage.getItem("wave-local-dir");
      if (dir) setLocalDir(dir);
    } catch {}
  };

  const saveConfig = () => {
    localStorage.setItem("wave-config", JSON.stringify(config));
    localStorage.setItem("wave-local-dir", localDir);
    notify(t("toasts").settingsSaved);
  };

  const handleTest = async (key: string) => {
    if (!services) return;
    setTesting(key);
    setTestResults((prev) => ({ ...prev, [key]: t("common").loading }));
    try {
      const providers = services.providers.filter((p) => {
        if (key === "WAVE_SOUNDCLOUD_CLIENT_ID") return p.id === "soundcloud";
        if (key === "WAVE_SPOTIFY_CLIENT_ID") return p.id === "spotify";
        if (key === "WAVE_VK_TOKEN") return p.id === "vk";
        if (key === "WAVE_LASTFM_API_KEY") return p.id === "lastfm";
        if (key === "WAVE_GENIUS_TOKEN") return p.id === "genius";
        return false;
      });
      if (providers.length > 0) {
        const results = await Promise.allSettled(providers.map((p) => p.search("test")));
        const ok = results.some((r) => r.status === "fulfilled");
        setTestResults((prev) => ({ ...prev, [key]: ok ? t("settings").testOK : t("settings").testFailed }));
      } else {
        setTestResults((prev) => ({ ...prev, [key]: t("settings").providerNotLoaded }));
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

  const envKeys = [
    { key: "WAVE_YTDLP_PATH", label: "yt-dlp path", placeholder: "yt-dlp (or full path)", type: "text" },
    { key: "WAVE_SOUNDCLOUD_CLIENT_ID", label: "SoundCloud Client ID", placeholder: "pJ6Fj6roW2KRzWAOwGj6kkQ8VRBJjyBD", type: "text", test: true },
    { key: "WAVE_SPOTIFY_CLIENT_ID", label: "Spotify Client ID", placeholder: "...", type: "text", test: true },
    { key: "WAVE_SPOTIFY_CLIENT_SECRET", label: "Spotify Client Secret", placeholder: "...", type: "password", test: false },
    { key: "WAVE_VK_TOKEN", label: "VK Token (user, scope=audio)", placeholder: "...", type: "password", test: true },
    { key: "WAVE_LASTFM_API_KEY", label: "Last.fm API Key", placeholder: "...", type: "text", test: true },
    { key: "WAVE_LASTFM_API_SECRET", label: "Last.fm API Secret", placeholder: "...", type: "password", test: false },
    { key: "WAVE_LASTFM_SESSION_KEY", label: "Last.fm Session Key", placeholder: "...", type: "password", test: false },
    { key: "WAVE_GENIUS_TOKEN", label: "Genius Access Token", placeholder: "...", type: "password", test: false },
    { key: "WAVE_API_TOKEN", label: "HTTP API Token (empty = auto)", placeholder: "auto-generated", type: "text", test: false },
  ];

  return (
    <div className="view settings-view">
      <h1>{t("settings").title}</h1>

      <section className="settings-section">
        <h2>{t("settings").apiKeys}</h2>
        <p className="muted">{t("settings").apiKeysDesc}</p>
        <div className="settings-grid">
          {envKeys.map(({ key, label, placeholder, type, test }) => (
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
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings").localFiles}</h2>
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
        <p className="muted">{t("settings").localFilesDesc}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings").actions}</h2>
        <div className="actions-row">
          <button className="btn btn-primary" onClick={saveConfig}>
            <SaveIcon size={18} /> {t("settings").save}
          </button>
          <button className="btn" onClick={loadConfig}>
            <RefreshCwIcon size={18} /> {t("settings").load}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("settings").accentFromCover}</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={accentEnabled}
            onChange={(e) => setAccentEnabled(e.target.checked)}
          />
          <span>{t("settings").accentFromCover}</span>
        </label>
        <p className="muted">{t("settings").accentFromCoverDesc}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings").notifications}</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={notificationsOn}
            onChange={(e) => {
              const on = e.target.checked;
              setNotificationsEnabled(on);
              setNotificationsOn(on);
            }}
          />
          <span>{t("settings").notifications}</span>
        </label>
        <p className="muted">{t("settings").notificationsDesc}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings").theme}</h2>
        <div className="actions-row">
          <button
            className={`btn ${theme === "light" ? "btn-primary" : ""}`}
            onClick={() => setTheme("light")}
          >
            {t("settings").themeLight}
          </button>
          <button
            className={`btn ${theme === "dark" ? "btn-primary" : ""}`}
            onClick={() => setTheme("dark")}
          >
            {t("settings").themeDark}
          </button>
        </div>
        <p className="muted">{t("settings").themeDesc}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings").updateYtDlp}</h2>
        <div className="actions-row">
          <button
            className="btn"
            onClick={async () => {
              const result = await invoke("yt_update");
              notify(typeof result === "string" ? result : t("settings").updateYtDlpDesc);
            }}
          >
            <RefreshCwIcon size={18} /> {t("settings").updateYtDlp}
          </button>
        </div>
        <p className="muted">{t("settings").updateYtDlpDesc}</p>
      </section>

      <section className="settings-section">
        <h2>{t("settings").backup}</h2>
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
      </section>
    </div>
  );
}