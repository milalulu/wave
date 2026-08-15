use serde_json::json;

/// Скробблинг Last.fm: подписанные запросы (md5) к audioscrobbler.
/// Креды берутся из env (WAVE_LASTFM_API_KEY / _SECRET / _SESSION_KEY)
/// или из персистентного конфига (Настройки → API keys).

pub struct LastFmCreds {
    pub api_key: String,
    pub api_secret: String,
    pub session_key: String,
}

fn md5_hex(s: &str) -> String {
    format!("{:x}", md5::compute(s.as_bytes()))
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

/// Креды: env имеет приоритет над сохранённым конфигом.
pub fn creds(app: &tauri::AppHandle) -> Option<LastFmCreds> {
    let persisted = crate::read_persisted_config(app);
    let get = |key: &str| env(key).or_else(|| crate::get_string(&persisted, key));
    Some(LastFmCreds {
        api_key: get("WAVE_LASTFM_API_KEY")?,
        api_secret: get("WAVE_LASTFM_API_SECRET")?,
        session_key: get("WAVE_LASTFM_SESSION_KEY")?,
    })
}

/// Скробблинг настроен и включён. Выключить можно через
/// WAVE_LASTFM_SCROBBLE_ENABLED=0 (env или конфиг).
pub fn scrobble_enabled(app: &tauri::AppHandle) -> bool {
    if creds(app).is_none() {
        return false;
    }
    let persisted = crate::read_persisted_config(app);
    let toggle = env("WAVE_LASTFM_SCROBBLE_ENABLED")
        .or_else(|| crate::get_string(&persisted, "WAVE_LASTFM_SCROBBLE_ENABLED"));
    !matches!(
        toggle.as_deref(),
        Some("0") | Some("false") | Some("False") | Some("FALSE")
    )
}

/// Подписанный POST на audioscrobbler. Подпись = md5(конкатенация
/// «name+value» всех параметров (кроме format/api_sig) в алфавитном порядке + secret).
pub async fn lfm_post(
    method: &str,
    params: &[(String, String)],
    creds: &LastFmCreds,
) -> Result<(), String> {
    let mut pairs: Vec<(String, String)> = params.to_vec();
    pairs.push(("api_key".into(), creds.api_key.clone()));
    pairs.push(("method".into(), method.to_string()));
    pairs.push(("sk".into(), creds.session_key.clone()));
    pairs.sort();

    let sig_input = pairs
        .iter()
        .map(|(k, v)| format!("{k}{v}"))
        .collect::<String>()
        + &creds.api_secret;
    let api_sig = md5_hex(&sig_input);
    pairs.push(("format".into(), "json".into()));
    pairs.push(("api_sig".into(), api_sig));

    let res = crate::http::client()
        .post("https://ws.audioscrobbler.com/2.0/")
        .form(&pairs)
        .send()
        .await
        .map_err(|e| format!("lastfm {method}: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("lastfm read: {e}"))?;
    if status != 200 {
        return Err(format!(
            "lastfm {method} failed: {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| {
        format!(
            "lastfm bad json: {}",
            text.chars().take(160).collect::<String>()
        )
    })?;
    if let Some(code) = value.get("error").and_then(|e| e.as_i64()) {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(format!("lastfm {method}: [{code}] {message}"));
    }
    let _ = json!(value);
    Ok(())
}

pub fn track_params(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u32>,
) -> Vec<(String, String)> {
    let mut params = vec![("track".to_string(), title)];
    if let Some(a) = artist.filter(|a| !a.trim().is_empty()) {
        params.push(("artist".to_string(), a));
    }
    if let Some(al) = album.filter(|a| !a.trim().is_empty()) {
        params.push(("album".to_string(), al));
    }
    if let Some(d) = duration.filter(|d| *d > 0) {
        params.push(("duration".to_string(), d.to_string()));
    }
    params
}
