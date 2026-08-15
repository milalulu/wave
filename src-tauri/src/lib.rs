pub mod android;
mod diag;
mod http;
pub mod lastfm;
#[cfg(target_os = "linux")]
pub mod mpris;
mod tools;

use crate::diag::diagnostics;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Лимит одновременных yt-dlp процессов (стрим/поиск/обновление).
/// Прелоад следующего трека + текущий стрим + радио не должны плодить процессы.
static YTDLP_SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();

fn ytdlp_slots() -> &'static tokio::sync::Semaphore {
    YTDLP_SLOTS.get_or_init(|| tokio::sync::Semaphore::new(2))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    ytdlp_path: Option<String>,
    ytdlp_cookies: Option<String>,
    soundcloud_client_id: Option<String>,
    spotify_client_id: Option<String>,
    spotify_client_secret: Option<String>,
    vk_token: Option<String>,
    lastfm_api_key: Option<String>,
    lastfm_api_secret: Option<String>,
    lastfm_session_key: Option<String>,
    lastfm_scrobble_enabled: bool,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
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
        soundcloud_client_id: env("WAVE_SOUNDCLOUD_CLIENT_ID")
            .or_else(|| get_string(&persisted, "WAVE_SOUNDCLOUD_CLIENT_ID")),
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
    }
}

/// Сохранить ключи API в персистентный конфиг (без env). Перезапись полным объектом.
#[tauri::command]
fn save_app_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = persisted_config_path(&app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, config.to_string()).map_err(|e| format!("save config: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
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
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut h = RandomState::new().build_hasher();
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| h.write_u64(d.as_nanos() as u64))
        .ok();
    h.write_u64(std::process::id() as u64);
    let a = h.finish();
    let mut h2 = RandomState::new().build_hasher();
    h2.write_u64(a);
    format!("{:016x}{:016x}", a, h2.finish())
}

#[tauri::command]
fn app_config(app: tauri::AppHandle) -> AppConfig {
    config(&app)
}

async fn run_ytdlp(
    app: &tauri::AppHandle,
    args: Vec<String>,
    timeout_secs: u64,
) -> Result<Option<String>, String> {
    // Не даём yt-dlp процессам плодиться: стримы/поиски встают в очередь.
    let _permit = ytdlp_slots()
        .acquire()
        .await
        .map_err(|_| "yt-dlp: semaphore closed".to_string())?;
    let binary = config(app)
        .ytdlp_path
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "yt-dlp".to_string());
    let mut cmd = tokio::process::Command::new(&binary);
    cmd.args(&args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Без этого на Windows всплывает консольное окно yt-dlp.exe.
        cmd.as_std_mut().creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let Ok(cmd) = cmd
        .kill_on_drop(true)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    else {
        return Err(format!("cannot spawn {binary}"));
    };
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        cmd.wait_with_output(),
    )
    .await
    .map_err(|_| "yt-dlp timeout".to_string())?
    .map_err(|e| format!("yt-dlp wait: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{binary} failed: {}",
            stderr.trim().lines().last().unwrap_or("unknown error")
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(if stdout.trim().is_empty() {
        None
    } else {
        Some(stdout)
    })
}

/// Аргументы yt-dlp из настройки `WAVE_YTDLP_COOKIES`:
/// путь к cookies.txt (`--cookies`) или имя браузера `browser:chrome` (`--cookies-from-browser`).
/// Лекарство от YouTube bot-check («Sign in to confirm you're not a bot»).
fn ytdlp_cookies_args(app: &tauri::AppHandle) -> Vec<String> {
    let Some(c) = config(app).ytdlp_cookies.filter(|s| !s.trim().is_empty()) else {
        return vec![];
    };
    let c = c.trim().to_string();
    if let Some(browser) = c.strip_prefix("browser:") {
        if browser.is_empty() {
            vec![]
        } else {
            vec!["--cookies-from-browser".to_string(), browser.to_string()]
        }
    } else {
        vec!["--cookies".to_string(), c]
    }
}

#[tauri::command]
async fn yt_search(
    app: tauri::AppHandle,
    query: String,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.clamp(1, 50);
    let search = format!("ytsearch{limit}:{query}");
    let mut args = vec![
        search,
        "--no-playlist".to_string(),
        "--flat-playlist".to_string(),
        "--dump-single-json".to_string(),
        "-J".to_string(),
        "--no-warnings".to_string(),
        "--extractor-args".to_string(),
        "youtube:player_client=web_safari".to_string(),
    ];
    args.extend(ytdlp_cookies_args(&app));
    let Some(stdout) = run_ytdlp(&app, args, 60).await? else {
        return Ok(vec![]);
    };
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("yt-dlp JSON: {e}"))?;
    let entries = parsed
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let out: Vec<serde_json::Value> = entries
        .into_iter()
        .filter_map(|e| {
            let id = e.get("id")?.as_str()?;
            let title = e
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let thumbnail = e
                .get("thumbnails")
                .and_then(|t| t.as_array())
                .and_then(|arr| arr.first())
                .and_then(|t| t.get("url"))
                .and_then(|u| u.as_str());
            Some(serde_json::json!({
                "id": id,
                "title": title,
                "uploader": e.get("uploader").and_then(|v| v.as_str()),
                "duration": e.get("duration").and_then(|v| v.as_i64()),
                "thumbnail": thumbnail,
            }))
        })
        .collect();
    Ok(out)
}

#[tauri::command]
async fn yt_stream(
    app: tauri::AppHandle,
    id: String,
    quality: Option<String>,
) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={id}");
    let audio_only = match quality.as_deref().unwrap_or("best") {
        "low" => "ba[abr<=48]",
        "medium" => "ba[abr<=128]",
        "high" => "ba[abr<=256]",
        _ => "ba",
    };
    let fallback_fmt = match quality.as_deref().unwrap_or("best") {
        "low" => "ba[abr<=48]/ba",
        "medium" => "ba[abr<=128]/ba",
        "high" => "ba[abr<=256]/ba",
        _ => "ba/b",
    };
    let cookies = ytdlp_cookies_args(&app);
    let attempts: Vec<Vec<String>> = vec![
        // Android-клиент отдаёт прямые не троттлящиеся URL.
        stream_args(
            &url,
            &format!("{audio_only}[ext=m4a]/{audio_only}"),
            Some("youtube:player_client=android"),
            &cookies,
        ),
        stream_args(
            &url,
            fallback_fmt,
            Some("youtube:player_client=web_safari"),
            &cookies,
        ),
        stream_args(&url, "ba/b", None, &cookies),
    ];
    let mut last_err: Option<String> = None;
    for args in attempts {
        match run_ytdlp(&app, args, 90).await {
            Ok(Some(stdout)) => {
                let u = stdout
                    .lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string());
                if let Some(u) = u {
                    // HLS/DASH манифесты (m3u8/mpd) WebView2 не играет — пробуем дальше.
                    if !u.contains(".m3u8") && !u.contains(".mpd") && !u.is_empty() {
                        return Ok(u);
                    }
                    last_err = Some("yt-dlp: got unplayable manifest".into());
                }
            }
            Ok(None) => {
                last_err = Some("yt-dlp: no stream".into());
            }
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| "yt-dlp: no playable stream".into()))
}

fn stream_args(url: &str, fmt: &str, client: Option<&str>, cookies: &[String]) -> Vec<String> {
    let mut args = vec![
        url.to_string(),
        "--no-playlist".to_string(),
        "-f".to_string(),
        fmt.to_string(),
        "-g".to_string(),
        "--no-warnings".to_string(),
    ];
    if let Some(c) = client {
        args.push("--extractor-args".to_string());
        args.push(c.to_string());
    }
    args.extend(cookies.iter().cloned());
    args
}

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
    for (k, v) in headers {
        builder = builder.header(k, v);
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
    let res = builder
        .send()
        .await
        .map_err(|e| format!("http {method} {redacted}: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("read body: {e}"))?;
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
    for (k, v) in headers {
        builder = builder.header(k, v);
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
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(android::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wave.db", migrations)
                .build(),
        )
        .manage(bridge.clone())
        .setup(move |app| {
            #[cfg(not(target_os = "android"))]
            {
                let token = resolve_api_token(app.handle());
                http::server::start(app.handle().clone(), bridge.clone(), token);
                #[cfg(target_os = "linux")]
                mpris::start(app.handle().clone());
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tools::ensure(&handle).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_respond,
            list_music_files,
            log_frontend,
            app_config,
            yt_search,
            yt_stream,
            vk_search,
            http_fetch_json,
            http_fetch_text,
            lastfm_update_now_playing,
            lastfm_scrobble,
            read_text_file,
            write_text_file,
            backup_database,
            restore_database,
            yt_update,
            yt_download,
            app_download_dir,
            tools_status,
            tools_detect,
            ensure_tools,
            read_audio_tags,
            write_audio_tags,
            save_app_config,
            relaunch,
            mpris_update,
            diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Перезапустить приложение (после установки обновления).
#[tauri::command]
fn relaunch(app: tauri::AppHandle) {
    app.restart();
}

/// Обновить состояние MPRIS. Реальный MPRIS живёт только на Linux;
/// на остальных платформах команда существует как no-op, чтобы
/// invoke_handler компилировался для всех таргетов.
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
    [
        app.path().home_dir(),
        app.path().app_local_data_dir(),
        app.path().app_data_dir(),
        app.path().app_config_dir(),
        app.path().download_dir(),
        app.path().document_dir(),
        app.path().desktop_dir(),
    ]
    .into_iter()
    .flatten()
    .collect()
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
    let dir = app.path().app_local_data_dir().ok()?;
    Some(dir.join("wave.db"))
}

#[tauri::command]
fn backup_database(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let db = wave_db_path(&app).ok_or("cannot resolve database path")?;
    std::fs::copy(&db, &path)
        .map_err(|e| format!("backup failed: {e}"))
        .map(|_| ())
}

/// Таблицы, которые обязаны быть в БД Wave (проверка файла перед restore).
const DB_TABLES: [&str; 5] = [
    "liked_tracks",
    "saved_albums",
    "saved_artists",
    "history",
    "playlists",
];

fn looks_like_wave_db(path: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    let f = std::fs::File::open(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut head = Vec::with_capacity(256 * 1024);
    f.take(256 * 1024)
        .read_to_end(&mut head)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if !head.starts_with(b"SQLite format 3\0") {
        return Err("file is not a SQLite database".to_string());
    }
    // Имена таблиц видны в sqlite_master — достаточно заглянуть в шапку файла.
    for table in DB_TABLES {
        if !head.windows(table.len()).any(|w| w == table.as_bytes()) {
            return Err(format!("database is missing table: {table}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn restore_database(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let db = wave_db_path(&app).ok_or("cannot resolve database path")?;
    looks_like_wave_db(std::path::Path::new(&path))?;
    if let Some(dir) = db.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::copy(&path, &db)
        .map_err(|e| format!("restore failed: {e}"))
        .map(|_| ())
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
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};

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
    let mut cmd = tokio::process::Command::new(&binary);
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

/// Простое скачивание файла по прямой ссылке (без yt-dlp).
async fn download_direct(url: &str, output_path: &str) -> Result<(), String> {
    let redacted = crate::http::redact_url(url);
    let res = crate::http::client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download {redacted}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download {redacted}: HTTP {}", res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("download {redacted}: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("download {redacted}: empty response"));
    }
    if let Some(dir) = std::path::Path::new(output_path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = format!("{output_path}.part");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write {tmp}: {e}"))?;
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
fn list_music_files(dir: String) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(&dir)];
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
    out
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
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(picture.data());
                let mime = picture
                    .mime_type()
                    .map(|m| m.to_string())
                    .unwrap_or_else(|| "image/jpeg".to_string());
                json["cover"] = serde_json::Value::String(format!("data:{mime};base64,{b64}"));
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
fn read_audio_tags(path: String) -> Result<AudioTags, String> {
    let tagged = lofty::read_from_path(&path).map_err(|e| format!("read {path}: {e}"))?;
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
) -> Result<(), String> {
    use lofty::tag::items::Timestamp;
    use lofty::tag::Accessor;
    let mut tagged = lofty::read_from_path(&path).map_err(|e| format!("read {path}: {e}"))?;
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
        .save_to_path(&path, lofty::config::WriteOptions::default())
        .map_err(|e| format!("write {path}: {e}"))?;
    Ok(())
}
