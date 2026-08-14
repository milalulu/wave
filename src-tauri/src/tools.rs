use serde::Serialize;
use tauri::Manager;

const YTDLP_RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
#[cfg(target_os = "windows")]
const FFMPEG_RELEASE: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

pub fn tools_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("tools")
}

pub fn ytdlp_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    tools_dir(app).join(name)
}

pub fn ffmpeg_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    tools_dir(app).join(if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
}

pub fn ytdlp_ready(app: &tauri::AppHandle) -> bool {
    let p = ytdlp_path(app);
    p.is_file() && p.metadata().map(|m| m.len() > 1_000_000).unwrap_or(false)
}

pub fn ffmpeg_ready(app: &tauri::AppHandle) -> bool {
    ffmpeg_path(app).is_file()
}

/// Путь к скачанному yt-dlp, если бинарь уже на месте (для `config()`).
pub fn ytdlp_present_path(app: &tauri::AppHandle) -> Option<String> {
    if ytdlp_ready(app) {
        Some(ytdlp_path(app).to_string_lossy().to_string())
    } else {
        None
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub ytdlp_path: Option<String>,
    pub ytdlp_ready: bool,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_ready: bool,
}

pub fn status(app: &tauri::AppHandle) -> ToolsStatus {
    ToolsStatus {
        ytdlp_path: Some(ytdlp_path(app).to_string_lossy().to_string()),
        ytdlp_ready: ytdlp_ready(app),
        ffmpeg_path: Some(ffmpeg_path(app).to_string_lossy().to_string()),
        ffmpeg_ready: ffmpeg_ready(app),
    }
}

async fn download_to(url: &str, dest: &std::path::Path) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download {url}: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download {url}: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("download {url}: empty response"));
    }
    let dir = dest.parent().ok_or_else(|| "no parent dir".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let tmp = dest.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, dest).map_err(|e| format!("rename to {}: {e}", dest.display()))?;
    Ok(())
}

async fn ensure_ytdlp(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = ytdlp_path(app);
    if ytdlp_ready(app) {
        return Ok(());
    }
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("yt-dlp");
    download_to(&format!("{YTDLP_RELEASE}{name}"), &dest).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<(), String> {
    use std::io::Read;

    let dest = ffmpeg_path(app);
    if ffmpeg_ready(app) {
        return Ok(());
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(FFMPEG_RELEASE)
        .send()
        .await
        .map_err(|e| format!("ffmpeg download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ffmpeg download: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("ffmpeg download: {e}"))?;
    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("ffmpeg zip: {e}"))?;
    let dir = dest.parent().ok_or_else(|| "no parent dir".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ffmpeg zip entry: {e}"))?;
        if entry.is_file() && entry.name().ends_with("bin/ffmpeg.exe") {
            let tmp = dest.with_extension(format!("tmp{}", std::process::id()));
            let mut out = std::fs::File::create(&tmp)
                .map_err(|e| format!("create {}: {e}", tmp.display()))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("extract ffmpeg: {e}"))?;
            drop(out);
            std::fs::rename(&tmp, &dest)
                .map_err(|e| format!("rename to {}: {e}", dest.display()))?;
            found = true;
            break;
        }
    }
    if !found {
        return Err("ffmpeg.exe not found in archive".into());
    }
    Ok(())
}

/// Скачать недостающие инструменты. Вызывается фоном при старте и по кнопке.
pub async fn ensure(app: &tauri::AppHandle) -> Result<ToolsStatus, String> {
    ensure_ytdlp(app).await?;
    #[cfg(target_os = "windows")]
    ensure_ffmpeg(app).await?;
    Ok(status(app))
}
