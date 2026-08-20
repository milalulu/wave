import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode, FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { useAuth } from "./AuthContext";
import { ACCENT_PRESETS, loadAccentColor, saveAccentColor, applyAccentColor } from "../app/accentStore";
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
import { CROSSFADE_MIN, CROSSFADE_MAX, CROSSFADE_STEP } from "../app/crossfade";
import { DISCOVERY_MIN, DISCOVERY_MAX } from "../app/discoveryRate";
import { HISTORY_DECAY_MIN, HISTORY_DECAY_MAX } from "../app/historyDecay";
import { AUTO_GEN_MIN, AUTO_GEN_MAX } from "../app/autoGenerateThreshold";
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
  const { user, loading: authLoading, configured: authConfigured, signOut, signInOAuth, signIn, signUp } = useAuth();
  const services = useApp((s) => s.services);
  const notify = useApp((s) => s.notify);
  const accentEnabled = useApp((s) => s.accentEnabled);
  const setAccentEnabled = useApp((s) => s.setAccentEnabled);
  const autoContinue = useApp((s) => s.autoContinue);
  const setAutoContinue = useApp((s) => s.setAutoContinue);
  const offlineMode = useApp((s) => s.offlineMode);
  const setOfflineMode = useApp((s) => s.setOfflineMode);
  const excludePreviews = useApp((s) => s.excludePreviews);
  const setExcludePreviews = useApp((s) => s.setExcludePreviews);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const lyricsAutoOpen = useApp((s) => s.lyricsAutoOpen);
  const setLyricsAutoOpen = useApp((s) => s.setLyricsAutoOpen);
  const lyricsAutoscroll = useApp((s) => s.lyricsAutoscroll);
  const setLyricsAutoscroll = useApp((s) => s.setLyricsAutoscroll);
  const crossfadeMs = useApp((s) => s.crossfadeMs);
  const setCrossfadeMs = useApp((s) => s.setCrossfadeMs);
  const discoveryRate = useApp((s) => s.discoveryRate);
  const setDiscoveryRate = useApp((s) => s.setDiscoveryRate);
  const historyDecayDays = useApp((s) => s.historyDecayDays);
  const setHistoryDecayDays = useApp((s) => s.setHistoryDecayDays);
  const autoGenerateThreshold = useApp((s) => s.autoGenerateThreshold);
  const setAutoGenerateThreshold = useApp((s) => s.setAutoGenerateThreshold);
  const bassBoost = useApp((s) => s.bassBoost);
  const setBassBoost = useApp((s) => s.setBassBoost);
  const reverb = useApp((s) => s.reverb);
  const setReverb = useApp((s) => s.setReverb);
  const stereoWidth = useApp((s) => s.stereoWidth);
  const setStereoWidth = useApp((s) => s.setStereoWidth);
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
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  const [emailAuthMode, setEmailAuthMode] = useState<"signin" | "signup">("signin");
  const [emailAuthLoading, setEmailAuthLoading] = useState(false);
  const [emailAuthError, setEmailAuthError] = useState<string | null>(null);
  const [emailForm, setEmailForm] = useState({ email: "", password: "" });
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(loadAccentColor);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleAccentColor = useCallback((color: string | null) => {
    setAccentColor(color);
    saveAccentColor(color);
    applyAccentColor(color);
  }, []);

  const handleOAuth = async (provider: "google" | "github") => {
    setOauthLoading(true);
    setOauthError(null);
    try {
      await signInOAuth(provider);
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : String(err));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    setEmailAuthLoading(true);
    setEmailAuthError(null);
    try {
      if (emailAuthMode === "signin") {
        await signIn(emailForm.email, emailForm.password);
      } else {
        await signUp(emailForm.email, emailForm.password);
      }
      setShowEmailAuth(false);
    } catch (err) {
      setEmailAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailAuthLoading(false);
    }
  };

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
                <button className={theme === "amoled" ? "active" : ""} onClick={() => setTheme("amoled")}>
                  {t("settings").themeAmoled}
                </button>
                <button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")}>
                  {t("settings").themeSystem}
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
      <div ref={containerRef} className="settings-cards" data-cols={containerWidth > 720 ? "2" : "1"}>
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
                checked={excludePreviews}
                onChange={(e) => setExcludePreviews(e.target.checked)}
              />
              <span>{t("settings").excludePreviews}</span>
            </label>
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
          <p className="muted">{t("settings").excludePreviewsDesc}</p>
          <p className="muted">{t("settings").accentFromCoverDesc}</p>
          <p className="muted">{t("settings").autoContinueDesc}</p>
          <p className="muted">{t("settings").offlineModeDesc}</p>
        </SettingsCard>

        <SettingsCard title={t("settings").accentColor}>
          <div className="accent-picker">
            <button
              className={`accent-swatch ${accentColor === null ? "active" : ""}`}
              style={{ background: "var(--accent)" }}
              onClick={() => handleAccentColor(null)}
              title="Default"
            />
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`accent-swatch ${accentColor === p.value ? "active" : ""}`}
                style={{ background: p.value }}
                onClick={() => handleAccentColor(p.value)}
                title={p.name}
              />
            ))}
            <label className="accent-custom" title="Custom">
              <input
                type="color"
                value={accentColor ?? "#7c5cff"}
                onChange={(e) => handleAccentColor(e.target.value)}
              />
            </label>
          </div>
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
          <div className="effect-slider">
            <label>{t("settings").crossfadeDuration}</label>
            <input
              type="range"
              min={CROSSFADE_MIN}
              max={CROSSFADE_MAX}
              step={CROSSFADE_STEP}
              value={crossfadeMs}
              onChange={(e) => setCrossfadeMs(Number(e.target.value))}
            />
            <span className="effect-value">{crossfadeMs === 0 ? t("settings").crossfadeOff : `${crossfadeMs} ms`}</span>
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").recommendations} desc={t("settings").recommendationsDesc}>
          <div className="effect-slider">
            <label>{t("settings").discoveryRate} <span className="muted">({discoveryRate}%)</span></label>
            <input
              type="range"
              min={DISCOVERY_MIN}
              max={DISCOVERY_MAX}
              step={1}
              value={discoveryRate}
              onChange={(e) => setDiscoveryRate(Number(e.target.value))}
            />
            <span className="muted">{t("settings").discoveryRateDesc}</span>
          </div>
          <div className="effect-slider">
            <label>{t("settings").historyDecay} <span className="muted">({historyDecayDays} {t("settings").days})</span></label>
            <input
              type="range"
              min={HISTORY_DECAY_MIN}
              max={HISTORY_DECAY_MAX}
              step={1}
              value={historyDecayDays}
              onChange={(e) => setHistoryDecayDays(Number(e.target.value))}
            />
            <span className="muted">{t("settings").historyDecayDesc}</span>
          </div>
          <div className="effect-slider">
            <label>{t("settings").autoGenerateThreshold}</label>
            <input
              type="range"
              min={AUTO_GEN_MIN}
              max={AUTO_GEN_MAX}
              step={1}
              value={autoGenerateThreshold}
              onChange={(e) => setAutoGenerateThreshold(Number(e.target.value))}
            />
            <span className="effect-value">{autoGenerateThreshold} {t("settings").tracksRemaining}</span>
          </div>
        </SettingsCard>

        <SettingsCard title={t("settings").audioEffects} desc={t("settings").audioEffectsDesc}>
          <div className="effects-sliders">
            <div className="effect-slider">
              <label>{t("settings").bassBoost}</label>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={bassBoost}
                onChange={(e) => setBassBoost(Number(e.target.value))}
              />
              <span className="effect-value">{bassBoost} dB</span>
            </div>
            <p className="muted">{t("settings").bassBoostDesc}</p>
            <div className="effect-slider">
              <label>{t("settings").reverb}</label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(reverb * 100)}
                onChange={(e) => setReverb(Number(e.target.value) / 100)}
              />
              <span className="effect-value">{Math.round(reverb * 100)}%</span>
            </div>
            <p className="muted">{t("settings").reverbDesc}</p>
            <div className="effect-slider">
              <label>{t("settings").stereoWidth}</label>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(stereoWidth * 100)}
                onChange={(e) => setStereoWidth(Number(e.target.value) / 100)}
              />
              <span className="effect-value">{stereoWidth > 0 ? "+" : ""}{Math.round(stereoWidth * 100)}%</span>
            </div>
            <p className="muted">{t("settings").stereoWidthDesc}</p>
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

        <SettingsCard title={t("settings").account} desc={t("settings").accountDesc}>
          {!authConfigured ? (
            <p className="muted">{t("settings").accountNotConfigured}</p>
          ) : authLoading ? (
            <div className="muted">{t("settings").loading}</div>
          ) : user ? (
            <div className="account-info">
              <div className="account-header">
                <div className="avatar">{user.email?.charAt(0).toUpperCase() ?? "U"}</div>
                <div>
                  <strong>{user.email}</strong>
                  <div className="muted">{t("settings").accountConnected}</div>
                </div>
              </div>
              <div className="settings-action-row">
                <button className="btn btn-danger" onClick={async () => { await signOut(); }}>
                  {t("settings").signOut}
                </button>
              </div>
            </div>
          ) : showEmailAuth ? (
            <form className="account-login" onSubmit={handleEmailAuth}>
              <p className="muted">{emailAuthMode === "signin" ? t("settings").signIn : t("settings").signUp}</p>
              {emailAuthError && <div className="error-message">{emailAuthError}</div>}
              <div className="form-group">
                <label htmlFor="auth-email">{t("settings").email}</label>
                <input
                  id="auth-email"
                  type="email"
                  value={emailForm.email}
                  onChange={(e) => setEmailForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="form-group">
                <label htmlFor="auth-password">{t("settings").password}</label>
                <input
                  id="auth-password"
                  type="password"
                  value={emailForm.password}
                  onChange={(e) => setEmailForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete={emailAuthMode === "signin" ? "current-password" : "new-password"}
                />
              </div>
              <div className="settings-action-row">
                <button type="submit" className="btn" disabled={emailAuthLoading}>
                  {emailAuthLoading ? "…" : emailAuthMode === "signin" ? t("settings").signIn : t("settings").signUp}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setShowEmailAuth(false);
                  setEmailAuthError(null);
                }}>
                  {t("settings").back}
                </button>
              </div>
              <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                {emailAuthMode === "signin" ? t("settings").noAccount : t("settings").hasAccount}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setEmailAuthMode((m) => (m === "signin" ? "signup" : "signin"));
                    setEmailAuthError(null);
                  }}
                >
                  {emailAuthMode === "signin" ? t("settings").createAccount : t("settings").signInInstead}
                </button>
              </p>
            </form>
          ) : (
            <div className="account-login">
              <p className="muted">{t("settings").accountNotConnected}</p>
              {oauthError && <div className="error-message">{oauthError}</div>}
              <div className="settings-action-row">
                <button className="btn" disabled={oauthLoading} onClick={() => handleOAuth("google")}>
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/></svg>
                  {oauthLoading ? "…" : "Google"}
                </button>
                <button className="btn" disabled={oauthLoading} onClick={() => handleOAuth("github")}>
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.28-1.56 3.285-1.23 3.285-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.925.435.375.81 1.11.81 2.25 0 1.635-.015 2.955-.015 3.36 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                  {oauthLoading ? "…" : "GitHub"}
                </button>
                <button className="btn" onClick={() => { setShowEmailAuth(true); setEmailAuthMode("signin"); setOauthError(null); }}>
                  {t("settings").emailPassword}
                </button>
              </div>
            </div>
          )}
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
          <div className="settings-actions">
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
                  notify(t("toasts").settingsSaved);
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
        <SettingsCard title={t("shortcuts").title}>
          <div className="shortcuts-list">
            {([
              ["Space", t("shortcuts").playPause],
              ["→", t("shortcuts").next],
              ["←", t("shortcuts").prev],
              ["↑", t("shortcuts").volumeUp],
              ["↓", t("shortcuts").volumeDown],
              ["M", t("shortcuts").mute],
              ["L", t("shortcuts").like],
              ["S", t("shortcuts").shuffle],
              ["/ or Ctrl+K", t("shortcuts").search],
              ["Ctrl+Q / Ctrl+W", t("shortcuts").closeWindow],
              ["Ctrl+Alt+Space", t("shortcuts").globalPlayPause],
              ["Ctrl+Alt+→", t("shortcuts").globalNext],
              ["Ctrl+Alt+←", t("shortcuts").globalPrev],
            ] as const).map(([key, label]) => (
              <div key={key} className="shortcut-row">
                <kbd>{key}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </SettingsCard>
      </div>
      )}
    </div>
  );
}
