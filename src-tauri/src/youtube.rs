//! YouTube search, stream resolution and bounded yt-dlp execution.
use crate::{config, proxy_conf};

static YTDLP_SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();

fn ytdlp_slots() -> &'static tokio::sync::Semaphore {
    YTDLP_SLOTS.get_or_init(|| tokio::sync::Semaphore::new(4))
}

pub(crate) fn ytdlp_proxy_args(app: &tauri::AppHandle, for_retry: bool) -> Vec<String> {
    let Some(conf) = proxy_conf(app) else {
        return vec![];
    };
    let use_proxy = conf.mode == crate::http::ProxyMode::Always || for_retry;
    if !use_proxy {
        return vec![];
    }
    vec!["--proxy".to_string(), conf.url]
}

/// Повторить ли yt-dlp через прокси после прямого провала (режим Auto).
pub(crate) fn ytdlp_should_retry_proxy(app: &tauri::AppHandle, used_proxy: bool) -> bool {
    if used_proxy {
        return false;
    }
    matches!(
        proxy_conf(app).map(|c| c.mode),
        Some(crate::http::ProxyMode::Auto)
    )
}

pub(crate) async fn run_ytdlp(
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
    // Прямой запуск (+прокси сразу в режиме Always), при провале в режиме
    // Auto — одна повторная попытка через прокси.
    let mut attempt_args = args.clone();
    attempt_args.splice(..0, ytdlp_proxy_args(app, false));
    match run_ytdlp_once(&binary, attempt_args, timeout_secs).await {
        Ok(out) => Ok(out),
        Err(e) => {
            if !ytdlp_should_retry_proxy(app, false) {
                return Err(e);
            }
            let mut retry_args = args.clone();
            retry_args.splice(..0, ytdlp_proxy_args(app, true));
            run_ytdlp_once(&binary, retry_args, timeout_secs).await
        }
    }
}

async fn run_ytdlp_once(
    binary: &str,
    args: Vec<String>,
    timeout_secs: u64,
) -> Result<Option<String>, String> {
    let mut cmd = tokio::process::Command::new(binary);
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
pub(crate) fn ytdlp_cookies_args(app: &tauri::AppHandle) -> Vec<String> {
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
pub(crate) async fn yt_search(
    app: tauri::AppHandle,
    query: String,
    limit: u32,
    provider: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.clamp(1, 50);
    let is_sc = provider.as_deref() == Some("sc");
    let search = if is_sc {
        format!("scsearch{limit}:{query}")
    } else {
        format!("ytsearchmusic{limit}:{query}")
    };
    let mut args = vec![
        search,
        "--no-playlist".to_string(),
        "--flat-playlist".to_string(),
        "--dump-single-json".to_string(),
        "-J".to_string(),
        "--no-warnings".to_string(),
    ];
    if !is_sc {
        args.push("--extractor-args".to_string());
        args.push("youtube:player_client=web_safari".to_string());
    }
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
            let duration = e
                .get("duration")
                .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)));
            if !is_sc {
                if let Some(d) = duration {
                    if d > 0 && d < 60 {
                        return None;
                    }
                    if d > 600 {
                        return None;
                    }
                }
                let lower = title.to_lowercase();
                let junk = [
                    "clip",
                    "shorts",
                    "official video",
                    "live performance",
                    "karaoke",
                    "reaction",
                    "нарезка",
                    "отрезки",
                    "клип",
                    "podcast",
                    "interview",
                    "behind the scenes",
                    "making of",
                    "mix",
                    "compilation",
                    "dj set",
                    "extended mix",
                    "vinyl rip",
                    "1 hour",
                    "2 hour",
                    "hour mix",
                    "megamix",
                    "best of",
                    "голубой огонь",
                    "non-stop",
                    "nonstop",
                    "continuous",
                    "medley",
                    "playlist",
                    "все песни",
                    "все хиты",
                    "альбом",
                    "album",
                    "rejected",
                    "spoof",
                    "type beat",
                    "typeBeat",
                    "free beat",
                    "free type",
                    "instrumental v2",
                    "remake",
                    "remix type",
                ];
                if junk.iter().any(|kw| lower.contains(kw)) {
                    return None;
                }
            }
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
                "duration": duration,
                "thumbnail": thumbnail,
            }))
        })
        .collect();
    Ok(out)
}

async fn resolve_stream(
    app: &tauri::AppHandle,
    url: &str,
    quality: Option<&str>,
    prefer_progressive: bool,
) -> Result<String, String> {
    let audio_only = match quality.unwrap_or("best") {
        "low" => "ba[abr<=48]",
        "medium" => "ba[abr<=128]",
        "high" => "ba[abr<=256]",
        _ => "ba",
    };
    let fallback_fmt = match quality.unwrap_or("best") {
        "low" => "ba[abr<=48]/ba",
        "medium" => "ba[abr<=128]/ba",
        "high" => "ba[abr<=256]/ba",
        _ => "ba/b",
    };
    let cookies = ytdlp_cookies_args(app);
    let mut attempts: Vec<Vec<String>> = vec![];
    if prefer_progressive {
        attempts.push(stream_args(
            url,
            &format!("{audio_only}[protocol=http]/{audio_only}[ext=mp3]/{audio_only}"),
            None,
            &cookies,
        ));
    }
    attempts.extend([
        stream_args(
            url,
            &format!("{audio_only}[ext=m4a]/{audio_only}"),
            None,
            &cookies,
        ),
        stream_args(
            url,
            &format!("{audio_only}[ext=m4a]/{audio_only}"),
            Some("youtube:player_client=android"),
            &cookies,
        ),
        stream_args(
            url,
            &format!("{audio_only}[ext=m4a]/{audio_only}"),
            Some("youtube:player_client=ios"),
            &cookies,
        ),
        stream_args(
            url,
            &format!("{audio_only}[ext=m4a]/{audio_only}"),
            Some("youtube:player_client=mweb"),
            &cookies,
        ),
        stream_args(url, fallback_fmt, None, &cookies),
        stream_args(
            url,
            fallback_fmt,
            Some("youtube:player_client=android"),
            &cookies,
        ),
    ]);
    let mut progressive_url: Option<String> = None;
    let mut hls_url: Option<String> = None;
    let mut last_err: Option<String> = None;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    for args in attempts {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let attempt = tokio::time::timeout(remaining, run_ytdlp(app, args, 12)).await;
        match attempt.unwrap_or_else(|_| Err("yt-dlp: resolve budget exceeded".into())) {
            Ok(Some(stdout)) => {
                let u = stdout
                    .lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string());
                if let Some(u) = u {
                    if u.is_empty() {
                        continue;
                    }
                    if u.contains(".m3u8") || u.contains(".mpd") {
                        if hls_url.is_none() {
                            hls_url = Some(u);
                        }
                    } else {
                        progressive_url = Some(u);
                        break;
                    }
                }
            }
            Ok(None) => {
                last_err = Some("yt-dlp: no stream".into());
            }
            Err(e) => last_err = Some(e),
        }
    }
    if let Some(u) = progressive_url {
        return Ok(u);
    }
    if let Some(u) = hls_url {
        return Ok(u);
    }
    Err(last_err.unwrap_or_else(|| "yt-dlp: no playable stream".into()))
}

#[tauri::command]
pub(crate) async fn yt_stream(
    app: tauri::AppHandle,
    id: String,
    quality: Option<String>,
) -> Result<String, String> {
    resolve_stream(
        &app,
        &format!("https://www.youtube.com/watch?v={id}"),
        quality.as_deref(),
        false,
    )
    .await
}

#[tauri::command]
pub(crate) async fn dl_stream(
    app: tauri::AppHandle,
    url: String,
    quality: Option<String>,
) -> Result<String, String> {
    resolve_stream(&app, &url, quality.as_deref(), true).await
}

/// Быстрый резолв YouTube-стрима: всего 2 попытки с жёстким таймаутом 10с.
#[tauri::command]
pub(crate) async fn yt_stream_fast(
    app: tauri::AppHandle,
    id: String,
    quality: Option<String>,
) -> Result<String, String> {
    let quality_str = quality.unwrap_or_else(|| "best".to_string());
    let audio_only = match quality_str.as_str() {
        "low" => "ba[abr<=48]",
        "medium" => "ba[abr<=128]",
        "high" => "ba[abr<=256]",
        _ => "ba",
    };
    let fmt = format!("{audio_only}[ext=m4a]/{audio_only}[ext=webm]/{audio_only}");
    let cookies = ytdlp_cookies_args(&app);
    let url_str = format!("https://www.youtube.com/watch?v={id}");

    let clients = ["android", "web_safari"];

    let mut handles = Vec::with_capacity(clients.len());
    for client in clients {
        let mut args = vec![
            url_str.clone(),
            "--no-playlist".to_string(),
            "-f".to_string(),
            fmt.clone(),
            "-g".to_string(),
            "--no-warnings".to_string(),
            "--socket-timeout".to_string(),
            "5".to_string(),
            "--extractor-args".to_string(),
            format!("youtube:player_client={client}"),
        ];
        args.extend(cookies.iter().cloned());
        let app2 = app.clone();
        handles.push(tokio::spawn(async move { run_ytdlp(&app2, args, 7).await }));
    }

    let mut progressive_url: Option<String> = None;
    let mut hls_url: Option<String> = None;
    for h in handles {
        if let Ok(Ok(Some(stdout))) = h.await {
            if let Some(u) = stdout
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .map(|l| l.trim().to_string())
            {
                if u.is_empty() {
                    continue;
                }
                if u.contains(".m3u8") || u.contains(".mpd") {
                    if hls_url.is_none() {
                        hls_url = Some(u);
                    }
                } else {
                    progressive_url = Some(u);
                    break;
                }
            }
        }
    }
    if let Some(u) = progressive_url {
        return Ok(u);
    }
    if let Some(u) = hls_url {
        return Ok(u);
    }

    // Фолбэк на полный resolve_stream с 7 попытками
    resolve_stream(&app, &url_str, Some(&quality_str), false).await
}

/// Быстрый резолв произвольного URL (SoundCloud и т.д.): 2 попытки, 10с таймаут,
/// с фолбэком на полный resolve_stream (7 попыток).
#[tauri::command]
pub(crate) async fn dl_stream_fast(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let cookies = ytdlp_cookies_args(&app);
    let attempts = vec![
        // Попытка 1: mp3 (SoundCloud обычно отдаёт mp3)
        {
            let mut args = vec![
                url.clone(),
                "--no-playlist".to_string(),
                "-f".to_string(),
                "ba[ext=mp3]/ba".to_string(),
                "-g".to_string(),
                "--no-warnings".to_string(),
                "--socket-timeout".to_string(),
                "5".to_string(),
            ];
            args.extend(cookies.iter().cloned());
            args
        },
        // Попытка 2: любой аудиоформат
        {
            let mut args = vec![
                url.clone(),
                "--no-playlist".to_string(),
                "-f".to_string(),
                "ba".to_string(),
                "-g".to_string(),
                "--no-warnings".to_string(),
                "--socket-timeout".to_string(),
                "5".to_string(),
            ];
            args.extend(cookies.iter().cloned());
            args
        },
    ];

    for args in attempts {
        if let Ok(Some(stdout)) = run_ytdlp(&app, args, 10).await {
            if let Some(u) = stdout
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .map(|l| l.trim().to_string())
            {
                if !u.is_empty() {
                    return Ok(u);
                }
            }
        }
    }

    // Фолбэк на полный resolve_stream (SoundCloud может требовать больше попыток)
    resolve_stream(&app, &url, None, true).await
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

// ─── Innertube API resolver (без yt-dlp, прямые HTTP-запросы) ───────────────

struct InnertubeClient {
    name: &'static str,
    version: &'static str,
    user_agent: &'static str,
}

static INNERTUBE_CLIENTS: &[InnertubeClient] = &[
    InnertubeClient {
        name: "ANDROID",
        version: "19.09.37",
        user_agent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
    },
    InnertubeClient {
        name: "IOS",
        version: "19.09.3",
        user_agent: "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
    },
    InnertubeClient {
        name: "ANDROID_MUSIC",
        version: "7.27.52",
        user_agent: "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 11) gzip",
    },
];

async fn try_innertube(
    video_id: &str,
    client: &InnertubeClient,
    quality: Option<&str>,
) -> Result<String, String> {
    let key = match client.name {
        "ANDROID" | "ANDROID_MUSIC" => Some("AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"),
        _ => None,
    };
    let mut client_context = serde_json::json!({
        "hl": "en",
        "gl": "US",
        "clientName": client.name,
        "clientVersion": client.version,
    });
    if client.name == "ANDROID" {
        client_context["androidSdkVersion"] = serde_json::json!(30);
    }
    let payload = serde_json::json!({
        "context": { "client": client_context },
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true,
    });

    let player_url = match key {
        Some(k) => format!("https://www.youtube.com/youtubei/v1/player?key={k}&prettyPrint=false"),
        None => "https://www.youtube.com/youtubei/v1/player?prettyPrint=false".to_string(),
    };

    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        crate::http::send_auto(|http| {
            http.post(player_url.clone())
                .header("Content-Type", "application/json")
                .header("User-Agent", client.user_agent)
                .json(&payload)
        }),
    )
    .await
    .map_err(|_| format!("innertube({}): timeout", client.name))?
    .map_err(|e| format!("innertube({}) request: {e}", client.name))?;

    if !resp.status().is_success() {
        return Err(format!("innertube({}) HTTP {}", client.name, resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("innertube({}) parse: {e}", client.name))?;

    let status = body["playabilityStatus"]["status"].as_str().unwrap_or("");
    if status != "OK" {
        let reason = body["playabilityStatus"]["reason"]
            .as_str()
            .unwrap_or("unknown");
        return Err(format!(
            "innertube({}): {} — {}",
            client.name, status, reason
        ));
    }

    let formats = body["streamingData"]["adaptiveFormats"]
        .as_array()
        .ok_or_else(|| format!("innertube({}): no streaming data", client.name))?;

    let mut audio: Vec<&serde_json::Value> = formats
        .iter()
        .filter(|f| f["mimeType"].as_str().unwrap_or("").starts_with("audio/"))
        .filter(|f| f["url"].as_str().is_some_and(|u| !u.is_empty()))
        .collect();

    if audio.is_empty() {
        return Err(format!(
            "innertube({}): no audio formats with direct URL",
            client.name
        ));
    }

    audio.sort_by(|a, b| compare_audio_formats(a, b, quality));

    audio
        .first()
        .and_then(|f| f["url"].as_str())
        .map(|u| u.to_string())
        .ok_or_else(|| format!("innertube({}): no URL", client.name))
}

fn compare_audio_formats(
    a: &serde_json::Value,
    b: &serde_json::Value,
    quality: Option<&str>,
) -> std::cmp::Ordering {
    let mp4 = |f: &serde_json::Value| f["mimeType"].as_str().unwrap_or("").contains("mp4");
    let a_br = a["bitrate"].as_u64().unwrap_or(0);
    let b_br = b["bitrate"].as_u64().unwrap_or(0);
    let rate = match quality.unwrap_or("best") {
        "low" => a_br.abs_diff(48_000).cmp(&b_br.abs_diff(48_000)),
        "medium" => a_br.abs_diff(128_000).cmp(&b_br.abs_diff(128_000)),
        "high" => a_br.abs_diff(256_000).cmp(&b_br.abs_diff(256_000)),
        _ => b_br.cmp(&a_br),
    };
    // Prefer the broadly supported MP4 container, then the requested bitrate.
    mp4(b).cmp(&mp4(a)).then(rate).then(a_br.cmp(&b_br))
}

#[cfg(test)]
mod stream_quality_tests {
    #[test]
    fn innertube_respects_requested_quality_within_supported_container() {
        let formats = [48_000, 128_000, 256_000]
            .map(|bitrate| serde_json::json!({"mimeType":"audio/mp4","bitrate":bitrate}));
        for (quality, expected) in [
            ("low", 48_000),
            ("medium", 128_000),
            ("high", 256_000),
            ("best", 256_000),
        ] {
            let mut candidates = formats.clone();
            candidates.sort_by(|a, b| super::compare_audio_formats(a, b, Some(quality)));
            assert_eq!(candidates[0]["bitrate"], expected);
        }
    }
}

#[tauri::command]
pub(crate) async fn yt_resolve_innertube(
    video_id: String,
    quality: Option<String>,
) -> Result<String, String> {
    let mut errs = Vec::new();
    for client in INNERTUBE_CLIENTS {
        match try_innertube(&video_id, client, quality.as_deref()).await {
            Ok(url) => return Ok(url),
            Err(e) => errs.push(e),
        }
    }
    Err(errs.join(" | "))
}

fn parse_yt_len(s: &str) -> Option<u64> {
    let parts: Vec<&str> = s.split(':').collect();
    let p = |i: usize| parts.get(i).and_then(|x| x.trim().parse::<u64>().ok());
    match parts.len() {
        1 => p(0),
        2 => Some(p(0)? * 60 + p(1)?),
        3 => Some(p(0)? * 3600 + p(1)? * 60 + p(2)?),
        _ => None,
    }
}

// "Up next" / радио по треку: innertube /next отдаёт реальный похожий плейлист.
#[tauri::command]
pub(crate) async fn yt_related_videos(
    video_id: String,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = limit.clamp(1, 30) as usize;
    // Планируем на 1 больше: первый элемент очереди всегда сам сид, его выкинем.
    let target = limit + 1;

    let ctx = serde_json::json!({
        "client": {
            "hl": "en",
            "gl": "US",
            "clientName": "WEB_REMIX",
            "clientVersion": "1.20260327.10.00",
        }
    });

    let first_payload = serde_json::json!({
        "context": &ctx,
        "videoId": &video_id,
    });

    let first_body = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let resp = crate::http::send_auto(|http| {
            http.post("https://music.youtube.com/youtubei/v1/next?prettyPrint=false")
                .header("Content-Type", "application/json")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                .json(&first_payload)
        })
        .await
        .map_err(|e| format!("innertube(next) reqwest: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("innertube(next) HTTP {}", status));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("{e}"))
    })
    .await
    .map_err(|_| "innertube(next): timeout".to_string())??;

    let mut playlist_id: Option<String> = None;
    let mut params: Option<String> = None;
    if let Some(tabs) = first_body["contents"]["singleColumnMusicWatchNextResultsRenderer"]
        ["tabbedRenderer"]["watchNextTabbedResultsRenderer"]["tabs"]
        .as_array()
    {
        for tab in tabs {
            if let Some(contents) = tab["tabRenderer"]["content"]["musicQueueRenderer"]["content"]
                ["playlistPanelRenderer"]["contents"]
                .as_array()
            {
                for item in contents {
                    if let Some(automix) = item.get("automixPreviewVideoRenderer") {
                        if let Some(inner) = automix["content"]["automixPlaylistVideoRenderer"]
                            .get("navigationEndpoint")
                        {
                            playlist_id = inner["watchPlaylistEndpoint"]["playlistId"]
                                .as_str()
                                .map(|s| s.to_string());
                            params = inner["watchPlaylistEndpoint"]["params"]
                                .as_str()
                                .map(|s| s.to_string());
                        }
                    }
                }
            }
        }
    }

    let body = if let (Some(ref pid), Some(ref p)) = (&playlist_id, &params) {
        let second_payload = serde_json::json!({
            "context": &ctx,
            "videoId": &video_id,
            "playlistId": pid,
            "params": p,
        });
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.post("https://music.youtube.com/youtubei/v1/next?prettyPrint=false")
                    .header("Content-Type", "application/json")
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
                    .json(&second_payload)
            })
            .await
            .map_err(|e| format!("innertube(next,with-playlist) reqwest: {e}"))?;
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("innertube(next,with-playlist) HTTP {}", status));
            }
            resp.json::<serde_json::Value>()
                .await
                .map_err(|e| format!("{e}"))
        })
        .await
        .map_err(|_| "innertube(next,with-playlist): timeout".to_string())??
    } else {
        first_body
    };

    let mut renderers: Vec<&serde_json::Value> = Vec::new();

    if let Some(tabs) = body["contents"]["singleColumnMusicWatchNextResultsRenderer"]
        ["tabbedRenderer"]["watchNextTabbedResultsRenderer"]["tabs"]
        .as_array()
    {
        for tab in tabs {
            if let Some(contents) = tab["tabRenderer"]["content"]["musicQueueRenderer"]["content"]
                ["playlistPanelRenderer"]["contents"]
                .as_array()
            {
                for it in contents {
                    if let Some(rl) = it.get("playlistPanelVideoRenderer") {
                        renderers.push(rl);
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    for rl in renderers {
        let id = rl["videoId"]
            .as_str()
            .or_else(|| rl["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() || id == video_id {
            continue;
        }
        let title = rl["title"]["runs"]
            .as_array()
            .and_then(|runs| runs.first())
            .and_then(|r| r["text"].as_str())
            .or_else(|| rl["title"]["simpleText"].as_str())
            .unwrap_or("")
            .to_string();
        let uploader = rl["longBylineText"]["runs"]
            .as_array()
            .and_then(|runs| runs.first())
            .and_then(|r| r["text"].as_str())
            .unwrap_or("")
            .to_string();
        let thumbnail = rl["thumbnail"]["thumbnails"]
            .as_array()
            .and_then(|thumbs| thumbs.last())
            .and_then(|t| t["url"].as_str())
            .map(|s| s.to_string());
        let duration_text = rl["lengthText"]["runs"]
            .as_array()
            .and_then(|runs| runs.first())
            .and_then(|r| r["text"].as_str())
            .or_else(|| rl["lengthText"]["simpleText"].as_str())
            .unwrap_or("");

        out.push(serde_json::json!({
            "id": id,
            "title": title,
            "uploader": uploader,
            "duration": parse_yt_len(duration_text).filter(|d| *d > 0),
            "thumbnail": thumbnail,
        }));
        if out.len() >= target {
            break;
        }
    }

    Ok(out)
}

// Innertube поиск (без yt-dlp): быстрый HTTP-запрос к YouTube search API.

// Innertube поиск (без yt-dlp): быстрый HTTP-запрос к YouTube search API.
#[tauri::command]
pub(crate) async fn yt_search_innertube(
    query: String,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let payload = serde_json::json!({
        "context": {
            "client": {
                "hl": "en",
                "gl": "US",
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
            }
        },
        "query": query,
    });

    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
                    .header("Content-Type", "application/json")
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
                    .json(&payload)
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "innertube search: timeout".to_string())?
        .map_err(|e| format!("innertube search: {e}"))?;

    if !status.is_success() {
        return Err(format!("innertube search HTTP {}", status));
    }

    let sections = body["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]
        ["sectionListRenderer"]["contents"]
        .as_array()
        .ok_or("innertube search: no results")?;

    let mut results = Vec::new();
    let limit = limit.min(50) as usize;

    for section in sections {
        let Some(items) = section["itemSectionRenderer"]["contents"].as_array() else {
            continue;
        };
        for item in items {
            let Some(video) = item["videoRenderer"].as_object() else {
                continue;
            };
            let id = video["videoId"].as_str().unwrap_or("");
            if id.is_empty() {
                continue;
            }
            let title = video["title"]["runs"]
                .as_array()
                .and_then(|r| r.first())
                .and_then(|r| r["text"].as_str())
                .unwrap_or("");
            let channel = video["ownerText"]["runs"]
                .as_array()
                .and_then(|r| r.first())
                .and_then(|r| r["text"].as_str());
            let duration_str = video["lengthText"]["simpleText"].as_str();
            let duration = duration_str.and_then(innertube_parse_duration);
            let thumbnail = video["thumbnail"]["thumbnails"]
                .as_array()
                .and_then(|t| t.last())
                .and_then(|t| t["url"].as_str());

            results.push(serde_json::json!({
                "id": id,
                "title": title,
                "uploader": channel,
                "duration": duration,
                "thumbnail": thumbnail,
            }));

            if results.len() >= limit {
                break;
            }
        }
        if results.len() >= limit {
            break;
        }
    }

    Ok(results)
}

/// Поиск YouTube через innertube — возвращает треки, артистов (каналы) и альбомы (плейлисты).
#[tauri::command]
pub(crate) async fn yt_search_innertube_full(
    query: String,
    limit: u32,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::json!({
        "context": {
            "client": {
                "hl": "en",
                "gl": "US",
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
            }
        },
        "query": query,
    });

    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
                    .header("Content-Type", "application/json")
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
                    .json(&payload)
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "innertube search full: timeout".to_string())?
        .map_err(|e| format!("innertube search full: {e}"))?;

    if !status.is_success() {
        return Err(format!("innertube search full HTTP {}", status));
    }

    let sections = body["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]
        ["sectionListRenderer"]["contents"]
        .as_array()
        .ok_or("innertube search full: no results")?;

    let limit = limit.min(50) as usize;
    let mut tracks = Vec::new();
    let mut artists = Vec::new();
    let mut albums = Vec::new();

    for section in sections {
        let Some(items) = section["itemSectionRenderer"]["contents"].as_array() else {
            continue;
        };
        for item in items {
            if let Some(video) = item.get("videoRenderer").and_then(|v| v.as_object()) {
                let id = video["videoId"].as_str().unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                let title = video["title"]["runs"]
                    .as_array()
                    .and_then(|r| r.first())
                    .and_then(|r| r["text"].as_str())
                    .unwrap_or("");
                let channel = video["ownerText"]["runs"]
                    .as_array()
                    .and_then(|r| r.first())
                    .and_then(|r| r["text"].as_str());
                let duration_str = video["lengthText"]["simpleText"].as_str();
                let duration = duration_str.and_then(innertube_parse_duration);
                let thumbnail = video["thumbnail"]["thumbnails"]
                    .as_array()
                    .and_then(|t| t.last())
                    .and_then(|t| t["url"].as_str());
                tracks.push(serde_json::json!({
                    "id": id,
                    "title": title,
                    "uploader": channel,
                    "duration": duration,
                    "thumbnail": thumbnail,
                }));
            } else if let Some(channel) = item.get("channelRenderer").and_then(|c| c.as_object()) {
                let id = channel["channelId"].as_str().unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                let name = channel["title"]["runs"]
                    .as_array()
                    .and_then(|r| r.first())
                    .and_then(|r| r["text"].as_str())
                    .unwrap_or("");
                let thumbnail = channel["thumbnail"]["thumbnails"]
                    .as_array()
                    .and_then(|t| t.last())
                    .and_then(|t| t["url"].as_str());
                let subscriber_count = channel["subscriberCountText"]["simpleText"].as_str();
                artists.push(serde_json::json!({
                    "id": id,
                    "name": name,
                    "thumbnail": thumbnail,
                    "subscriberCount": subscriber_count,
                }));
            } else if let Some(playlist) = item.get("playlistRenderer").and_then(|p| p.as_object())
            {
                let id = playlist["playlistId"].as_str().unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                let title = playlist["title"]["simpleText"]
                    .as_str()
                    .or_else(|| {
                        playlist["title"]["runs"]
                            .as_array()
                            .and_then(|r| r.first())
                            .and_then(|r| r["text"].as_str())
                    })
                    .unwrap_or("");
                let thumbnail = playlist["thumbnail"]["thumbnails"]
                    .as_array()
                    .and_then(|t| t.last())
                    .and_then(|t| t["url"].as_str());
                let track_count = playlist["videoCountShortText"]["simpleText"]
                    .as_str()
                    .or_else(|| playlist["videoCountText"]["simpleText"].as_str())
                    .and_then(|s| s.replace(",", "").replace(" ", "").parse::<u32>().ok());
                let owner = playlist["ownerText"]["runs"]
                    .as_array()
                    .and_then(|r| r.first())
                    .and_then(|r| r["text"].as_str());
                albums.push(serde_json::json!({
                    "id": id,
                    "title": title,
                    "thumbnail": thumbnail,
                    "trackCount": track_count,
                    "artist": owner,
                }));
            }
            if tracks.len() + artists.len() + albums.len() >= limit * 3 {
                break;
            }
        }
        if tracks.len() + artists.len() + albums.len() >= limit * 3 {
            break;
        }
    }

    Ok(serde_json::json!({
        "tracks": tracks,
        "artists": artists,
        "albums": albums,
    }))
}

fn innertube_parse_duration(text: &str) -> Option<i64> {
    let parts: Vec<&str> = text.split(':').collect();
    match parts.len() {
        2 => {
            let min = parts[0].parse::<i64>().ok()?;
            let sec = parts[1].parse::<i64>().ok()?;
            Some(min * 60 + sec)
        }
        3 => {
            let hr = parts[0].parse::<i64>().ok()?;
            let min = parts[1].parse::<i64>().ok()?;
            let sec = parts[2].parse::<i64>().ok()?;
            Some(hr * 3600 + min * 60 + sec)
        }
        _ => None,
    }
}

// ─── SoundCloud native resolver (без yt-dlp) ───────────────────────────────
