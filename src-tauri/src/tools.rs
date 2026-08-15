use serde::Serialize;
use tauri::Manager;

const YTDLP_RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

/// Пиннированный релиз ffmpeg (BtbN). Датированные теги держатся ~2 года;
/// имя файла (N-<hash>) берём из checksums.sha256 этого же релиза.
#[cfg(target_os = "windows")]
const FFMPEG_TAG: &str = "autobuild-2026-07-31-14-10";
#[cfg(target_os = "windows")]
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
    let cursor = std::io::Cursor::new(bytes.as_slice());
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
