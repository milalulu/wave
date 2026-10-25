#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
mod agent_model;
mod soundcloud;
mod youtube;
use youtube::{run_ytdlp, ytdlp_cookies_args, ytdlp_proxy_args, ytdlp_should_retry_proxy};
pub mod android;
mod cast;
mod cast_relay;
mod database_backup;
mod diag;
pub mod discord_rpc;
mod http;
pub mod lastfm;
#[cfg(target_os = "linux")]
pub mod mpris;
mod plugin_host;
mod plugin_support;
mod tools;
#[cfg(not(target_os = "android"))]
mod tray;

use crate::diag::diagnostics;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    ytdlp_path: Option<String>,
    ytdlp_cookies: Option<String>,
    spotify_client_id: Option<String>,
    spotify_client_secret: Option<String>,
    vk_token: Option<String>,
    lastfm_api_key: Option<String>,
    lastfm_api_secret: Option<String>,
    lastfm_session_key: Option<String>,
    lastfm_scrobble_enabled: bool,
    proxy_url: Option<String>,
    proxy_mode: Option<String>,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

#[tauri::command]
fn desktop_agent_available() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux"
    ))
}

/// Файл персистентного конфига (настройки API без env-переменных).
/// Кросс-платформенно: app_config_dir есть на Windows/Linux/Android.
fn persisted_config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("wave-config.json")
}

pub(crate) fn read_persisted_config(app: &tauri::AppHandle) -> serde_json::Value {
    std::fs::read_to_string(persisted_config_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

pub(crate) fn get_string(json: &serde_json::Value, key: &str) -> Option<String> {
    json.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
}

fn config(app: &tauri::AppHandle) -> AppConfig {
    let persisted = read_persisted_config(app);
    AppConfig {
        ytdlp_path: env("WAVE_YTDLP_PATH")
            .or_else(|| get_string(&persisted, "WAVE_YTDLP_PATH"))
            .or_else(|| tools::resolve_ytdlp(app)),
        ytdlp_cookies: env("WAVE_YTDLP_COOKIES")
            .or_else(|| get_string(&persisted, "WAVE_YTDLP_COOKIES")),
        spotify_client_id: env("WAVE_SPOTIFY_CLIENT_ID")
            .or_else(|| get_string(&persisted, "WAVE_SPOTIFY_CLIENT_ID")),
        spotify_client_secret: env("WAVE_SPOTIFY_CLIENT_SECRET")
            .or_else(|| get_string(&persisted, "WAVE_SPOTIFY_CLIENT_SECRET")),
        vk_token: env("WAVE_VK_TOKEN").or_else(|| get_string(&persisted, "WAVE_VK_TOKEN")),
        lastfm_api_key: env("WAVE_LASTFM_API_KEY")
            .or_else(|| get_string(&persisted, "WAVE_LASTFM_API_KEY")),
        lastfm_api_secret: env("WAVE_LASTFM_API_SECRET")
            .or_else(|| get_string(&persisted, "WAVE_LASTFM_API_SECRET")),
        lastfm_session_key: env("WAVE_LASTFM_SESSION_KEY")
            .or_else(|| get_string(&persisted, "WAVE_LASTFM_SESSION_KEY")),
        lastfm_scrobble_enabled: lastfm::scrobble_enabled(app),
        proxy_url: env("WAVE_PROXY_URL").or_else(|| get_string(&persisted, "WAVE_PROXY_URL")),
        proxy_mode: env("WAVE_PROXY_MODE").or_else(|| get_string(&persisted, "WAVE_PROXY_MODE")),
    }
}

/// Текущая proxy-конфигурация (env → persisted). Пустой URL = выкл.
fn proxy_conf(app: &tauri::AppHandle) -> Option<crate::http::ProxyConf> {
    let cfg = config(app);
    crate::http::proxy_conf_from_parts(cfg.proxy_url, cfg.proxy_mode)
}

/// Применить proxy-конфиг к общему HTTP-клиенту.
fn apply_proxy_conf(app: &tauri::AppHandle) {
    crate::http::configure_proxy(proxy_conf(app));
}

/// Сохранить ключи API в персистентный конфиг (без env). Мерж с существующим.
#[tauri::command]
fn save_app_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = persisted_config_path(&app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let merged = match std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    {
        Some(mut existing) => {
            if let (Some(obj), Some(patch)) = (existing.as_object_mut(), config.as_object()) {
                for (k, v) in patch {
                    obj.insert(k.clone(), v.clone());
                }
            }
            existing
        }
        None => config,
    };
    std::fs::write(&path, merged.to_string()).map_err(|e| format!("save config: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    apply_proxy_conf(&app);
    Ok(())
}

fn resolve_api_token(app: &tauri::AppHandle) -> String {
    if let Some(t) = env("WAVE_API_TOKEN") {
        return t;
    }
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let file = dir.join("api-token");
    if let Ok(existing) = std::fs::read_to_string(&file) {
        let t = existing.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    let token = random_token();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&file, &token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    token
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("failed to generate random token");
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[tauri::command]
fn app_config(app: tauri::AppHandle) -> AppConfig {
    config(&app)
}

/// Аргументы прокси для yt-dlp: в режиме Always — всегда, иначе пусто
/// (в режиме Auto повтор с прокси делает вызывающий код).
#[tauri::command]
async fn proxy_test(
    app: tauri::AppHandle,
    url: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let conf = match (url, mode) {
        (Some(u), m) => crate::http::proxy_conf_from_parts(Some(u), m),
        (None, Some(m)) => {
            let saved = proxy_conf(&app).map(|c| c.url);
            crate::http::proxy_conf_from_parts(saved, Some(m))
        }
        (None, None) => proxy_conf(&app),
    }
    .ok_or_else(|| "proxy not configured".to_string())?;
    // Применяем свежий конфиг (мог измениться без рестарта) и бьём строго в прокси.
    crate::http::configure_proxy(Some(conf));
    let proxied =
        crate::http::proxied_client().ok_or_else(|| "proxy not configured".to_string())?;
    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        proxied
            .get("https://www.youtube.com/generate_204")
            .header("User-Agent", "Mozilla/5.0")
            .send(),
    )
    .await
    .map_err(|_| "proxy test: timeout".to_string())?
    .map_err(|e| format!("proxy test: {e}"))?;
    if resp.status().is_success() {
        Ok(format!("proxy OK ({})", resp.status()))
    } else {
        Err(format!("proxy HTTP {}", resp.status()))
    }
}

/// Нативный поиск SoundCloud (api-v2), без yt-dlp — работает и на Android.
#[tauri::command]
async fn http_fetch_json(
    method: String,
    url: String,
    body: Option<serde_json::Value>,
    headers: Vec<(String, String)>,
) -> Result<serde_json::Value, String> {
    let parsed = crate::http::validate_http_url(&url).await?;
    let redacted = crate::http::redact_url(parsed.as_str());
    let client = crate::http::client();
    let mut builder = match method.as_str() {
        "GET" => client.get(parsed.clone()),
        "POST" => client.post(parsed.clone()),
        "PUT" => client.put(parsed.clone()),
        "DELETE" => client.delete(parsed.clone()),
        _ => return Err(format!("unsupported method {method}")),
    };
    let form_content_type = headers.iter().any(|(k, v)| {
        k.eq_ignore_ascii_case("content-type") && v.contains("x-www-form-urlencoded")
    });
    let blocked = ["cookie", "authorization", "x-api-token", "set-cookie"];
    for (k, v) in &headers {
        if blocked.iter().any(|b| k.eq_ignore_ascii_case(b)) {
            continue;
        }
        builder = builder.header(k.as_str(), v.as_str());
    }
    if let Some(b) = body {
        if let Some(obj) = b.as_object() {
            if form_content_type {
                let params: Vec<(String, String)> = obj
                    .iter()
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                    .collect();
                builder = builder.form(&params);
            } else {
                builder = builder.json(&b);
            }
        } else {
            builder = builder.json(&b);
        }
    }
    let (status, text) = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let res = builder
            .send()
            .await
            .map_err(|e| format!("http {method} {redacted}: {e}"))?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|e| format!("read body: {e}"))?;
        Ok::<_, String>((status, text))
    })
    .await
    .map_err(|_| format!("http {method} {redacted}: timeout"))??;
    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|_| {
        format!(
            "http {status} non-json body: {}",
            text.chars().take(120).collect::<String>()
        )
    })?;
    Ok(serde_json::json!({ "status": status, "body": parsed }))
}

#[tauri::command]
async fn http_fetch_text(
    method: String,
    url: String,
    body: Option<serde_json::Value>,
    headers: Vec<(String, String)>,
) -> Result<serde_json::Value, String> {
    let parsed = crate::http::validate_http_url(&url).await?;
    let redacted = crate::http::redact_url(parsed.as_str());
    let client = crate::http::client();
    let mut builder = match method.as_str() {
        "GET" => client.get(parsed.clone()),
        "POST" => client.post(parsed.clone()),
        "PUT" => client.put(parsed.clone()),
        "DELETE" => client.delete(parsed.clone()),
        _ => return Err(format!("unsupported method {method}")),
    };
    let blocked = ["cookie", "authorization", "x-api-token", "set-cookie"];
    for (k, v) in &headers {
        if blocked.iter().any(|b| k.eq_ignore_ascii_case(b)) {
            continue;
        }
        builder = builder.header(k.as_str(), v.as_str());
    }
    if let Some(b) = body {
        builder = builder.json(&b);
    }
    let res = builder
        .send()
        .await
        .map_err(|e| format!("http {method} {redacted}: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("read body: {e}"))?;
    Ok(serde_json::json!({ "status": status, "text": text }))
}

#[tauri::command]
async fn vk_search(
    app: tauri::AppHandle,
    query: String,
    count: u32,
) -> Result<serde_json::Value, String> {
    let token = config(&app)
        .vk_token
        .ok_or("VK token not set: вставьте его в Настройках")?;
    let count_str = count.to_string();
    let form = [
        ("act", "search"),
        ("al", "1"),
        ("access_token", token.as_str()),
        ("q", query.as_str()),
        ("count", count_str.as_str()),
        ("type", "track"),
        ("v", "5.131"),
        ("offset", "0"),
        ("is_regular", "1"),
        ("need_album_info", "1"),
    ];
    let client = crate::http::client();
    let res = client
        .post("https://vk.com/al_audio.php")
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("vk search: {e}"))?;
    let text = res.text().await.map_err(|e| format!("vk read: {e}"))?;
    let cleaned = text.strip_prefix("<!--").unwrap_or(&text);
    let json: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        format!(
            "vk json: {e}: {}",
            cleaned.chars().take(160).collect::<String>()
        )
    })?;
    Ok(json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bridge = http::bridge::Bridge::new();
    let migrations = vec![
        Migration {
            version: 1,
            description: "liked tracks",
            sql: "CREATE TABLE IF NOT EXISTS liked_tracks (
                id TEXT PRIMARY KEY,
                track_json TEXT NOT NULL,
                liked_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "saved albums",
            sql: "CREATE TABLE IF NOT EXISTS saved_albums (
                id TEXT PRIMARY KEY,
                album_json TEXT NOT NULL,
                saved_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "saved artists",
            sql: "CREATE TABLE IF NOT EXISTS saved_artists (
                id TEXT PRIMARY KEY,
                artist_json TEXT NOT NULL,
                saved_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "play history",
            sql: "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_json TEXT NOT NULL,
                played_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "playlists",
            sql: "CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                playlist_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "history index",
            sql: "CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "queue state persistence",
            sql: "CREATE TABLE IF NOT EXISTS queue_state (id TEXT PRIMARY KEY, tracks_json TEXT NOT NULL, track_index INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "extra indexes",
            sql: "CREATE INDEX IF NOT EXISTS idx_liked_tracks_id ON liked_tracks(id); CREATE INDEX IF NOT EXISTS idx_saved_albums_id ON saved_albums(id); CREATE INDEX IF NOT EXISTS idx_saved_artists_id ON saved_artists(id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "recording identities and preferred playback sources",
            sql: "CREATE TABLE IF NOT EXISTS recording_preferences (id TEXT PRIMARY KEY, groups_json TEXT NOT NULL);",
            kind: MigrationKind::Up,
        },
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(android::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wave.db", migrations)
                .build(),
        )
        .manage(bridge.clone())
        .manage(cast::CastHost::default())
        .setup(move |app| {
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            app.manage(agent_model::ModelState::default());
            {
                let plugins_dir = app
                    .path()
                    .app_config_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
                    .join("plugins");
                app.manage(plugin_host::PluginHost::new(
                    app.handle().clone(),
                    plugins_dir,
                ));
            }
            apply_proxy_conf(app.handle());
            #[cfg(not(target_os = "android"))]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                let token = resolve_api_token(app.handle());
                http::server::start(app.handle().clone(), bridge.clone(), token);
                #[cfg(target_os = "linux")]
                mpris::start(app.handle().clone());
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tools::ensure(&handle).await;
                });
                tray::start(app);

                // Set window icon from compiled-in 128x128 PNG
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let bytes = include_bytes!("../icons/256x256.png");
                    if let Ok(icon) = tauri::image::Image::from_bytes(bytes) {
                        let _ = window.set_icon(icon);
                    }
                }
            }
            #[cfg(target_os = "android")]
            http::media::start().map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_model_begin,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_model_cancel,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_model_complete,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_key_present,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_key_save,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            agent_model::agent_key_delete,
            desktop_agent_available,
            api_respond,
            list_music_files,
            log_frontend,
            app_config,
            youtube::yt_search,
            youtube::yt_stream,
            youtube::yt_stream_fast,
            youtube::dl_stream,
            youtube::dl_stream_fast,
            youtube::yt_resolve_innertube,
            youtube::yt_related_videos,
            youtube::yt_search_innertube,
            youtube::yt_search_innertube_full,
            soundcloud::sc_resolve_stream,
            soundcloud::sc_search,
            soundcloud::sc_search_users,
            soundcloud::sc_related_tracks,
            soundcloud::sc_resolve_url,
            proxy_test,
            vk_search,
            http_fetch_json,
            http_fetch_text,
            lastfm_update_now_playing,
            lastfm_scrobble,
            read_text_file,
            write_text_file,
            backup_database,
            open_mini_player,
            restore_database,
            yt_update,
            yt_download,
            download_cover,
            app_download_dir,
            tools_status,
            tools_detect,
            ensure_tools,
            read_audio_tags,
            write_audio_tags,
            save_app_config,
            relaunch,
            mpris_update,
            set_discord_presence,
            clear_discord_presence,
            cast::cast_discover,
            cast::cast_connect,
            cast::cast_disconnect,
            cast::cast_load,
            cast::cast_control,
            cast::cast_status,
            plugin_ready,
            plugin_list,
            plugin_reload,
            plugin_set_enabled,
            plugin_open_dir,
            plugin_event,
            plugin_state,
            plugin_search_result,
            plugin_data_result,
            plugin_install,
            diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn set_discord_presence(
    client_id: String,
    details: String,
    state: String,
    large_image: Option<String>,
    large_text: Option<String>,
    small_image: Option<String>,
    small_text: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> Result<(), String> {
    discord_rpc::set_presence(
        client_id,
        details,
        state,
        large_image,
        large_text,
        small_image,
        small_text,
        start_ts,
        end_ts,
    )
    .await
}

#[tauri::command]
async fn clear_discord_presence() -> Result<(), String> {
    discord_rpc::clear_presence().await
}

#[tauri::command]
async fn plugin_ready(state: tauri::State<'_, plugin_host::PluginHost>) -> Result<(), String> {
    let host = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.reload())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn plugin_list(state: tauri::State<plugin_host::PluginHost>) -> Vec<plugin_host::PluginInfo> {
    state.list()
}

#[tauri::command]
async fn plugin_reload(
    state: tauri::State<'_, plugin_host::PluginHost>,
) -> Result<Vec<plugin_host::PluginInfo>, String> {
    let host = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.reload();
        host.list()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn plugin_set_enabled(
    state: tauri::State<'_, plugin_host::PluginHost>,
    id: String,
    enabled: bool,
) -> Result<Vec<plugin_host::PluginInfo>, String> {
    let host = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.set_enabled(&id, enabled)?;
        Ok(host.list())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn plugin_open_dir(app: tauri::AppHandle, state: tauri::State<plugin_host::PluginHost>) {
    state.open_dir(&app);
}

#[tauri::command]
fn plugin_event(
    state: tauri::State<plugin_host::PluginHost>,
    name: String,
    value: Option<serde_json::Value>,
) {
    state.push_event(&name, value);
}

#[tauri::command]
fn plugin_state(state: tauri::State<plugin_host::PluginHost>, value: serde_json::Value) {
    state.push_state(value);
}

#[tauri::command]
fn plugin_search_result(
    state: tauri::State<plugin_host::PluginHost>,
    req_id: u64,
    value: serde_json::Value,
) {
    state.search_result(req_id, value);
}

#[tauri::command]
fn plugin_data_result(
    state: tauri::State<plugin_host::PluginHost>,
    req_id: u64,
    value: serde_json::Value,
) {
    state.data_result(req_id, value);
}

#[tauri::command]
async fn plugin_install(
    state: tauri::State<'_, plugin_host::PluginHost>,
    url: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.install(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn relaunch(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
async fn mpris_update(app: tauri::AppHandle, state_json: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        mpris::mpris_update(app, state_json).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state_json);
        Ok(())
    }
}

#[tauri::command]
fn api_respond(
    state: tauri::State<'_, http::bridge::BridgeHandle>,
    id: u64,
    value: serde_json::Value,
) -> Result<(), String> {
    state.respond(id, value)
}

#[tauri::command]
async fn lastfm_update_now_playing(
    app: tauri::AppHandle,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u32>,
) -> Result<(), String> {
    let creds =
        lastfm::creds(&app).ok_or("lastfm: not configured (set Key, Secret and Session Key)")?;
    lastfm::lfm_post(
        "track.updateNowPlaying",
        &lastfm::track_params(title, artist, album, duration),
        &creds,
    )
    .await
}

#[tauri::command]
async fn lastfm_scrobble(
    app: tauri::AppHandle,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u32>,
    timestamp: i64,
) -> Result<(), String> {
    let creds =
        lastfm::creds(&app).ok_or("lastfm: not configured (set Key, Secret and Session Key)")?;
    let mut params = lastfm::track_params(title, artist, album, duration);
    params.push(("timestamp".to_string(), timestamp.to_string()));
    lastfm::lfm_post("track.scrobble", &params, &creds).await
}

#[tauri::command]
fn read_text_file(path: String, app: tauri::AppHandle) -> Result<String, String> {
    let safe = resolve_safe_path(&app, &path, false)?;
    std::fs::read_to_string(&safe).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String, app: tauri::AppHandle) -> Result<(), String> {
    let safe = resolve_safe_path(&app, &path, true)?;
    std::fs::write(&safe, content).map_err(|e| format!("write {path}: {e}"))
}

/// Корни, внутри которых разрешены read_text_file/write_text_file
/// (выбор через системные диалоги почти всегда попадает под них).
fn allowed_roots(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let mut roots = vec![
        app.path().home_dir(),
        app.path().app_local_data_dir(),
        app.path().app_data_dir(),
        app.path().app_config_dir(),
        app.path().download_dir(),
        app.path().document_dir(),
    ];
    #[cfg(not(target_os = "android"))]
    roots.push(app.path().desktop_dir());
    roots.into_iter().flatten().collect()
}

/// Нормализация пути для сравнения (Windows — без учёта регистра).
fn path_norm(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let s = s.to_lowercase();
    s
}

fn path_within(root: &std::path::Path, target: &std::path::Path) -> bool {
    let root = path_norm(root);
    let target = path_norm(target);
    target == root || target.starts_with(&format!("{root}/"))
}

/// Проверить, что путь лежит внутри разрешённых каталогов, и вернуть
/// канонический путь (симлинки разрешаются, `..` схлопывается).
fn resolve_safe_path(
    app: &tauri::AppHandle,
    path: &str,
    writable: bool,
) -> Result<std::path::PathBuf, String> {
    let canonical_roots: Vec<std::path::PathBuf> = allowed_roots(app)
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .collect();
    if canonical_roots.is_empty() {
        return Err("cannot resolve allowed directories".to_string());
    }
    let candidate = if writable {
        let raw = std::path::PathBuf::from(path);
        let parent = raw
            .parent()
            .ok_or_else(|| format!("invalid path: {path}"))?
            .to_path_buf();
        std::fs::create_dir_all(&parent).map_err(|e| format!("create dir {parent:?}: {e}"))?;
        let canon = parent
            .canonicalize()
            .map_err(|e| format!("resolve {parent:?}: {e}"))?;
        let name = raw
            .file_name()
            .ok_or_else(|| format!("invalid path: {path}"))?;
        canon.join(name)
    } else {
        std::path::PathBuf::from(path)
            .canonicalize()
            .map_err(|e| format!("resolve {path}: {e}"))?
    };
    if canonical_roots.iter().any(|r| path_within(r, &candidate)) {
        Ok(candidate)
    } else {
        Err(format!("path not allowed: {path}"))
    }
}

fn wave_db_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // tauri-plugin-sql resolves sqlite:wave.db relative to app_config_dir.
    Some(app.path().app_config_dir().ok()?.join("wave.db"))
}

#[tauri::command]
async fn backup_database(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let safe = resolve_safe_path(&app, &path, true)?;
    let db = wave_db_path(&app).ok_or("cannot resolve database path")?;
    database_backup::backup(&db, &safe).await
}

#[tauri::command]
async fn restore_database(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let safe = resolve_safe_path(&app, &path, false)?;
    let db = wave_db_path(&app).ok_or("cannot resolve database path")?;
    database_backup::restore(&safe, &db).await
}

#[tauri::command]
async fn open_mini_player(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let window = if let Some(window) = app.get_webview_window("mini-player") {
            window
        } else {
            tauri::WebviewWindowBuilder::new(
                &app,
                "mini-player",
                tauri::WebviewUrl::App("mini.html".into()),
            )
            .title("Wave mini player")
            .inner_size(400.0, 150.0)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .build()
            .map_err(|e| e.to_string())?
        };
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err("Mini player is available on desktop".into())
    }
}

#[tauri::command]
async fn yt_update(app: tauri::AppHandle) -> Result<String, String> {
    let Some(stdout) = run_ytdlp(&app, vec!["-U".to_string()], 120).await? else {
        return Ok("yt-dlp is up to date".into());
    };
    Ok(stdout.trim().to_string())
}

#[tauri::command]
async fn tools_status(app: tauri::AppHandle) -> tools::ToolsStatus {
    tools::status(&app)
}

/// Авто-детект yt-dlp (установленный в app data или системный в PATH) —
/// для кнопки «найти» в настройках (важно на Android, где PATH может не содержать yt-dlp).
#[tauri::command]
async fn tools_detect(app: tauri::AppHandle) -> Option<String> {
    tools::resolve_ytdlp(&app)
}

#[tauri::command]
async fn ensure_tools(app: tauri::AppHandle) -> Result<tools::ToolsStatus, String> {
    tools::ensure(&app).await
}

#[tauri::command]
async fn yt_download(
    app: tauri::AppHandle,
    url: String,
    output_path: String,
    job_id: Option<String>,
) -> Result<(), String> {
    // Прямые ссылки на аудио (iTunes-превью, Deezer, SoundCloud, локальные)
    // качаем минуя yt-dlp: быстрее и работает даже без установленного бинаря
    // (важно для Android, где yt-dlp обычно недоступен).
    if !is_youtube_page_url(&url) && (url.starts_with("http://") || url.starts_with("https://")) {
        return download_direct(&url, &output_path).await;
    }

    let binary = config(&app)
        .ytdlp_path
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "yt-dlp".to_string());
    let mut args: Vec<String> = vec![
        url.clone(),
        "-f".to_string(),
        "ba/b".to_string(),
        "-o".to_string(),
        output_path.clone(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--newline".to_string(),
        "--extractor-args".to_string(),
        "youtube:player_client=android,web_safari".to_string(),
    ];
    args.extend(ytdlp_cookies_args(&app));
    let ffmpeg_location = if tools::ffmpeg_ready(&app) {
        Some(tools::tools_dir(&app))
    } else {
        None
    };
    if let Some(loc) = ffmpeg_location.as_ref() {
        args.push("--ffmpeg-location".to_string());
        args.push(loc.to_str().unwrap_or_default().to_string());
    }
    let mut first_args = args.clone();
    first_args.splice(..0, ytdlp_proxy_args(&app, false));
    match yt_download_once(&app, &binary, first_args, job_id.clone()).await {
        Ok(()) => Ok(()),
        Err(e) => {
            if !ytdlp_should_retry_proxy(&app, false) {
                return Err(e);
            }
            let mut retry_args = args;
            retry_args.splice(..0, ytdlp_proxy_args(&app, true));
            yt_download_once(&app, &binary, retry_args, job_id).await
        }
    }
}

async fn yt_download_once(
    app: &tauri::AppHandle,
    binary: &str,
    args: Vec<String>,
    job_id: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut cmd = tokio::process::Command::new(binary);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.as_std_mut().creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .kill_on_drop(true)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot spawn {binary}: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let handle = app.clone();
    let job = job_id.clone();
    let progress = async move {
        let mut lines = String::new();
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(percent) = parse_ytdlp_percent(&line) {
                    let _ = handle.emit(
                        "download-progress",
                        serde_json::json!({ "jobId": job, "percent": percent }),
                    );
                }
                lines.push_str(&line);
                lines.push('\n');
            }
        }
        if let Some(err) = stderr {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(percent) = parse_ytdlp_percent(&line) {
                    let _ = handle.emit(
                        "download-progress",
                        serde_json::json!({ "jobId": job, "percent": percent }),
                    );
                }
                lines.push_str(&line);
                lines.push('\n');
            }
        }
        lines
    };

    let progress = tokio::time::timeout(std::time::Duration::from_secs(300), progress);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        child.wait_with_output(),
    );
    let (log, output) = tokio::join!(progress, output);

    if output
        .as_ref()
        .ok()
        .and_then(|o| o.as_ref().ok())
        .map(|o| !o.status.success())
        .unwrap_or(false)
    {
        let msg = log.unwrap_or_default();
        let tail = msg
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("{binary} failed: {tail}"));
    }
    match output {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(format!("yt-dlp wait: {e}")),
        Err(_) => Err("yt-dlp download timeout".to_string()),
    }
}

/// Страница YouTube — такой URL требует yt-dlp (иначе качаем напрямую).
fn is_youtube_page_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("youtube.com/watch")
        || lower.contains("music.youtube.com/watch")
        || lower.contains("youtu.be/")
}

/// Скачать обложку трека по URL и сохранить в указанный файл.
#[tauri::command]
async fn download_cover(url: String, output_path: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("empty cover url".to_string());
    }
    download_direct(&url, &output_path).await
}

/// Простое скачивание файла по прямой ссылке (без yt-dlp).
async fn download_direct(url: &str, output_path: &str) -> Result<(), String> {
    use futures_util::StreamExt;
    let redacted = crate::http::redact_url(url);
    let res = crate::http::send_auto(|http| http.get(url))
        .await
        .map_err(|e| format!("download {redacted}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download {redacted}: HTTP {}", res.status()));
    }
    if let Some(dir) = std::path::Path::new(output_path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = format!("{output_path}.part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create {tmp}: {e}"))?;
    let mut stream = res.bytes_stream();
    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download {redacted}: {e}"))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| format!("write {tmp}: {e}"))?;
        total += chunk.len() as u64;
    }
    if total == 0 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("download {redacted}: empty response"));
    }
    if std::path::Path::new(output_path).exists() {
        std::fs::remove_file(output_path).map_err(|e| format!("remove {output_path}: {e}"))?;
    }
    std::fs::rename(&tmp, output_path).map_err(|e| format!("rename to {output_path}: {e}"))?;
    Ok(())
}

#[tauri::command]
fn app_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_local_data_dir().map(|p| p.join("downloads")))
        .map_err(|e| format!("cannot resolve download dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Вытащить процент из строки прогресса yt-dlp: `[download]   5.2% of 10.5MiB ...`.
fn parse_ytdlp_percent(line: &str) -> Option<u32> {
    let line = line.trim_start();
    if !line.starts_with("[download]") {
        return None;
    }
    let after = line.trim_start_matches("[download]").trim_start();
    let bytes = after.as_bytes();
    let mut i = 0;
    while i < bytes.len() && !bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let start = i;
    let mut seen_dot = false;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_digit() {
            i += 1;
        } else if b == b'.' && !seen_dot {
            seen_dot = true;
            i += 1;
        } else {
            break;
        }
    }
    if i < bytes.len() && bytes[i] == b'%' && i > start {
        after[start..i]
            .parse::<f32>()
            .ok()
            .map(|p| p.min(100.0) as u32)
    } else {
        None
    }
}

#[tauri::command]
fn log_frontend(message: String) {
    eprintln!("[web] {message}");
}

const MUSIC_EXTENSIONS: [&str; 8] = ["mp3", "m4a", "flac", "ogg", "opus", "wav", "aac", "wma"];

/// Рекурсивный обход папки: возвращает музыкальные файлы
/// с тегами (ID3/FLAC/MP4…) и длительностью, если они есть.
#[tauri::command]
fn list_music_files(dir: String, app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let safe = resolve_safe_path(&app, &dir, false)?;
    let mut out = Vec::new();
    let mut stack = vec![safe];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if MUSIC_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                out.push(file_meta(&path));
            }
        }
    }
    Ok(out)
}

fn file_meta(path: &std::path::Path) -> serde_json::Value {
    let fallback = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let mut json = serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "title": fallback,
    });
    if let Ok(tagged) = lofty::read_from_path(path) {
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if let Some(title) = tag.title().map(|t| t.to_string()).filter(|t| !t.is_empty()) {
                json["title"] = serde_json::Value::String(title);
            }
            if let Some(artist) = tag
                .artist()
                .map(|a| a.to_string())
                .filter(|a| !a.is_empty())
            {
                json["artist"] = serde_json::Value::String(artist);
            }
            if let Some(album) = tag.album().map(|a| a.to_string()).filter(|a| !a.is_empty()) {
                json["album"] = serde_json::Value::String(album);
            }
            if let Some(picture) = tag.pictures().first() {
                if picture.data().len() <= 200_000 {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(picture.data());
                    let mime = picture
                        .mime_type()
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| "image/jpeg".to_string());
                    json["cover"] = serde_json::Value::String(format!("data:{mime};base64,{b64}"));
                }
            }
        }
        let duration = tagged.properties().duration().as_secs();
        if duration > 0 {
            json["duration"] = serde_json::json!(duration);
        }
    }
    json
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioTags {
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: Option<u32>,
    track_number: Option<u32>,
    cover: Option<String>,
}

/// Прочитать текущие теги файла (для окна редактирования тегов).
#[tauri::command]
fn read_audio_tags(path: String, app: tauri::AppHandle) -> Result<AudioTags, String> {
    let safe = resolve_safe_path(&app, &path, false)?;
    let tagged = lofty::read_from_path(&safe).map_err(|e| format!("read {path}: {e}"))?;
    let mut tags = AudioTags {
        title: String::new(),
        artist: String::new(),
        album: String::new(),
        genre: String::new(),
        year: None,
        track_number: None,
        cover: None,
    };
    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        if let Some(title) = tag.title().filter(|t| !t.is_empty()) {
            tags.title = title.to_string();
        }
        if let Some(artist) = tag.artist().filter(|a| !a.is_empty()) {
            tags.artist = artist.to_string();
        }
        if let Some(album) = tag.album().filter(|a| !a.is_empty()) {
            tags.album = album.to_string();
        }
        if let Some(genre) = tag.genre().filter(|g| !g.is_empty()) {
            tags.genre = genre.to_string();
        }
        if let Some(year) = tag.date().map(|d| u32::from(d.year)).filter(|y| *y > 0) {
            tags.year = Some(year);
        }
        if let Some(track) = tag.track().filter(|t| *t > 0) {
            tags.track_number = Some(track);
        }
        if let Some(picture) = tag.pictures().first() {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(picture.data());
            let mime = picture
                .mime_type()
                .map(|m| m.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());
            tags.cover = Some(format!("data:{mime};base64,{b64}"));
        }
    }
    Ok(tags)
}

/// Записать теги в аудиофайл.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn write_audio_tags(
    path: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: Option<u32>,
    track_number: Option<u32>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let safe = resolve_safe_path(&app, &path, true)?;
    use lofty::tag::items::Timestamp;
    use lofty::tag::Accessor;
    let mut tagged = lofty::read_from_path(&safe).map_err(|e| format!("read {path}: {e}"))?;
    let tag = if let Some(t) = tagged.primary_tag_mut() {
        t
    } else if let Some(t) = tagged.first_tag_mut() {
        t
    } else {
        let new_tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tagged.insert_tag(new_tag);
        tagged
            .first_tag_mut()
            .ok_or_else(|| format!("cannot create tags for {path}"))?
    };
    if !title.is_empty() {
        tag.set_title(title);
    }
    if !artist.is_empty() {
        tag.set_artist(artist);
    }
    if !album.is_empty() {
        tag.set_album(album);
    }
    if !genre.is_empty() {
        tag.set_genre(genre);
    }
    if let Some(y) = year.filter(|y| *y > 0) {
        tag.set_date(Timestamp {
            year: y as u16,
            ..Default::default()
        });
    }
    if let Some(t) = track_number.filter(|t| *t > 0) {
        tag.set_track(t);
    }
    tagged
        .save_to_path(&safe, lofty::config::WriteOptions::default())
        .map_err(|e| format!("write {path}: {e}"))?;
    Ok(())
}
