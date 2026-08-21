use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const YTDLP_RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

static YTDLP_LOOKUP: OnceLock<Mutex<Option<Option<String>>>> = OnceLock::new();

fn ytdlp_lookup() -> &'static Mutex<Option<Option<String>>> {
    YTDLP_LOOKUP.get_or_init(|| Mutex::new(None))
}

/// Резолв пути yt-dlp: сначала установленный в app data, затем в PATH.
/// Результат кэшируется до установки/обновления инструментов.
pub fn resolve_ytdlp(app: &tauri::AppHandle) -> Option<String> {
    if let Some(cached) = ytdlp_lookup().lock().ok().and_then(|g| g.clone()) {
        return cached;
    }
    let resolved = ytdlp_present_path(app).or_else(system_ytdlp);
    if let Ok(mut g) = ytdlp_lookup().lock() {
        *g = Some(resolved.clone());
    }
    resolved
}

fn system_ytdlp() -> Option<String> {
    let mut cmd = std::process::Command::new("yt-dlp");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.arg("--version")
        .output()
        .ok()
        .map(|o| if o.status.success() { "yt-dlp" } else { "" }.to_string())
        .filter(|s| !s.is_empty())
}

/// Сбросить кэш пути после установки/обновления yt-dlp.
pub fn reset_ytdlp_cache() {
    if let Ok(mut g) = ytdlp_lookup().lock() {
        *g = None;
    }
}

/// Сериализует установку инструментов (стартовый фон + кнопка «Установить»).
static ENSURE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

/// Пиннированный релиз ffmpeg (BtbN). Датированные теги держатся ~2 года;
/// имя файла (N-<hash>) берём из checksums.sha256 этого же релиза.
#[cfg(target_os = "windows")]
const FFMPEG_TAG: &str = "autobuild-2026-07-31-14-10";
#[cfg(target_os = "windows")]
const FFMPEG_BASE: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/";

#[cfg(target_os = "linux")]
const FFMPEG_TAG: &str = "autobuild-2026-07-31-14-10";
#[cfg(target_os = "linux")]
const FFMPEG_BASE: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/";

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
    let p = ffmpeg_path(app);
    p.is_file() && p.metadata().map(|m| m.len() > 5_000_000).unwrap_or(false)
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

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Вытащить sha256 для `filename` из `hash  filename`-подобного файла.
/// Допускает маркер `*` перед именем (стиль sha256sum для бинарей).
fn checksum_for(checksums_text: &str, filename: &str) -> Option<String> {
    checksums_text.lines().find_map(|line| {
        let mut it = line.split_whitespace();
        let hash = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        if name == filename && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            Some(hash.to_string())
        } else {
            None
        }
    })
}

/// Имя win64-gpl.zip в checksums пина (файл вида ffmpeg-N-<hash>-win64-gpl.zip).
#[cfg(target_os = "windows")]
fn ffmpeg_zip_name(checksums_text: &str) -> Option<&str> {
    checksums_text.lines().find_map(|line| {
        let mut it = line.split_whitespace();
        let _ = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        if name.ends_with("win64-gpl.zip") {
            Some(name)
        } else {
            None
        }
    })
}

#[cfg(target_os = "linux")]
fn ffmpeg_archive_name(checksums_text: &str) -> Option<&str> {
    checksums_text.lines().find_map(|line| {
        let mut it = line.split_whitespace();
        let _ = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        if name.ends_with("linux64-gpl.tar.xz") {
            Some(name)
        } else {
            None
        }
    })
}

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let resp = crate::http::client()
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
    Ok(bytes.to_vec())
}

fn write_atomic(dest: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let dir = dest.parent().ok_or_else(|| "no parent dir".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let tmp = dest.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    // Windows: rename не перезаписывает существующий файл — чистим перед заменой.
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| format!("remove {}: {e}", dest.display()))?;
    }
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
    let sums = download_bytes(&format!("{YTDLP_RELEASE}SHA2-256SUMS")).await?;
    let text = String::from_utf8_lossy(&sums);
    let expected =
        checksum_for(&text, name).ok_or_else(|| format!("no sha256 for {name} in SHA2-256SUMS"))?;
    let bytes = download_bytes(&format!("{YTDLP_RELEASE}{name}")).await?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "yt-dlp checksum mismatch for {name}: got {actual}, want {expected}"
        ));
    }
    write_atomic(&dest, &bytes)?;
    reset_ytdlp_cache();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = ffmpeg_path(app);
    if ffmpeg_ready(app) {
        return Ok(());
    }
    let sums_url = format!("{FFMPEG_BASE}{FFMPEG_TAG}/checksums.sha256");
    let sums = download_bytes(&sums_url).await?;
    let text = String::from_utf8_lossy(&sums);
    let zip_name = ffmpeg_zip_name(&text)
        .ok_or_else(|| format!("ffmpeg: win64-gpl.zip not found in {sums_url}"))?;
    let expected =
        checksum_for(&text, zip_name).ok_or_else(|| format!("ffmpeg: no sha256 for {zip_name}"))?;
    let url = format!("{FFMPEG_BASE}{FFMPEG_TAG}/{zip_name}");
    let bytes = download_bytes(&url).await?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "ffmpeg checksum mismatch for {zip_name}: got {actual}, want {expected}"
        ));
    }
    let cursor = std::io::Cursor::new(&bytes[..]);
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

#[cfg(target_os = "macos")]
async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = ffmpeg_path(app);
    if ffmpeg_ready(app) {
        return Ok(());
    }
    // evermeet.cx provides a static ffmpeg binary directly (no archive extraction needed).
    let url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
    let resp = crate::http::client()
        .get(url)
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
    if bytes.is_empty() {
        return Err("ffmpeg download: empty response".into());
    }
    let cursor = std::io::Cursor::new(&bytes[..]);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("ffmpeg zip: {e}"))?;
    let dir = dest.parent().ok_or_else(|| "no parent dir".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ffmpeg zip entry: {e}"))?;
        if entry.is_file() && entry.name().ends_with("ffmpeg") {
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
        return Err("ffmpeg not found in evermeet archive".into());
    }
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    Ok(())
}

#[cfg(target_os = "linux")]
async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = ffmpeg_path(app);
    if ffmpeg_ready(app) {
        return Ok(());
    }
    let sums_url = format!("{FFMPEG_BASE}{FFMPEG_TAG}/checksums.sha256");
    let sums = download_bytes(&sums_url).await?;
    let text = String::from_utf8_lossy(&sums);
    let archive_name = ffmpeg_archive_name(&text)
        .ok_or_else(|| format!("ffmpeg: linux archive not found in {sums_url}"))?;
    let expected = checksum_for(&text, archive_name)
        .ok_or_else(|| format!("ffmpeg: no sha256 for {archive_name}"))?;
    let url = format!("{FFMPEG_BASE}{FFMPEG_TAG}/{archive_name}");
    let bytes = download_bytes(&url).await?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "ffmpeg checksum mismatch for {archive_name}: got {actual}, want {expected}"
        ));
    }
    let dir = dest.parent().ok_or_else(|| "no parent dir".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    if archive_name.ends_with(".tar.xz") {
        let tmp_dir = dir.join(format!(".ffmpeg_extract_{}", std::process::id()));
        std::fs::create_dir_all(&tmp_dir)
            .map_err(|e| format!("mkdir {}: {e}", tmp_dir.display()))?;
        let archive_path = tmp_dir.join("ffmpeg.tar.xz");
        std::fs::write(&archive_path, &bytes).map_err(|e| format!("write archive: {e}"))?;
        let ok = std::process::Command::new("tar")
            .arg("xf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&tmp_dir)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            let mut found = false;
            for entry in std::fs::read_dir(&tmp_dir).into_iter().flatten().flatten() {
                let p = entry.path();
                if p.is_file() && p.file_name().and_then(|n| n.to_str()) == Some("ffmpeg") {
                    std::fs::copy(&p, &dest).map_err(|e| format!("copy ffmpeg: {e}"))?;
                    found = true;
                    break;
                }
            }
            let _ = std::fs::remove_dir_all(&tmp_dir);
            if !found {
                return Err("ffmpeg not found in tar.xz".into());
            }
        } else {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err("failed to extract ffmpeg: tar failed".into());
        }
    } else {
        write_atomic(&dest, &bytes)?;
    }
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    Ok(())
}

/// Скачать недостающие инструменты. Вызывается фоном при старте и по кнопке.
/// На Android yt-dlp не скачиваем: официальный релиз — Linux-запускаемый
/// zipapp, которому нужен интерпретатор python3 (его нет). Юзер может задать
/// путь к бинарю (Termux и т.п.) в настройках.
pub async fn ensure(app: &tauri::AppHandle) -> Result<ToolsStatus, String> {
    let _guard = ENSURE_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    #[cfg(not(target_os = "android"))]
    ensure_ytdlp(app).await?;
    #[cfg(not(target_os = "android"))]
    ensure_ffmpeg(app).await?;
    Ok(status(app))
}

#[cfg(test)]
mod tests {
    use super::checksum_for;

    const YTDLP_SUMS: &str = "\
495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd  yt-dlp
52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8  yt-dlp.exe
";

    #[test]
    fn parses_two_space_format() {
        let hash = checksum_for(YTDLP_SUMS, "yt-dlp.exe").unwrap();
        assert_eq!(
            hash,
            "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8"
        );
    }

    #[test]
    fn accepts_star_binary_marker() {
        let text = "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd *yt-dlp\n";
        let hash = checksum_for(text, "yt-dlp").unwrap();
        assert_eq!(
            hash,
            "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd"
        );
    }

    #[test]
    fn rejects_missing_or_bad_hashes() {
        assert!(checksum_for(YTDLP_SUMS, "ffmpeg.exe").is_none());
        assert!(checksum_for("nope  yt-dlp.exe\n", "yt-dlp.exe").is_none());
    }
}
