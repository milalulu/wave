use serde_json::json;

/// Скробблинг Last.fm: подписанные запросы (md5) к audioscrobbler.
/// Требуются переменные окружения WAVE_LASTFM_API_KEY, WAVE_LASTFM_API_SECRET,
/// WAVE_LASTFM_SESSION_KEY (сессия получается через auth.getSession после
/// авторизации пользователя на last.fm).
fn lfm_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn md5_hex(s: &str) -> String {
    format!("{:x}", md5::compute(s.as_bytes()))
}

/// Скробблинг настроен: ключ + секрет + session key.
pub fn scrobble_enabled() -> bool {
    lfm_env("WAVE_LASTFM_API_KEY").is_some()
        && lfm_env("WAVE_LASTFM_API_SECRET").is_some()
        && lfm_env("WAVE_LASTFM_SESSION_KEY").is_some()
}

/// Подписанный POST на audioscrobbler. Подпись = md5(конкатенация
/// «name+value» всех параметров (кроме format/api_sig) в алфавитном порядке + secret).
pub async fn lfm_post(method: &str, params: &[(String, String)]) -> Result<(), String> {
    let api_key = lfm_env("WAVE_LASTFM_API_KEY").ok_or("WAVE_LASTFM_API_KEY not set")?;
    let secret = lfm_env("WAVE_LASTFM_API_SECRET").ok_or("WAVE_LASTFM_API_SECRET not set")?;
    let sk = lfm_env("WAVE_LASTFM_SESSION_KEY").ok_or("WAVE_LASTFM_SESSION_KEY not set")?;

    let mut pairs: Vec<(String, String)> = params.to_vec();
    pairs.push(("api_key".into(), api_key));
    pairs.push(("method".into(), method.to_string()));
    pairs.push(("sk".into(), sk));
    pairs.sort();

    let sig_input = pairs
        .iter()
        .map(|(k, v)| format!("{k}{v}"))
        .collect::<String>()
        + &secret;
    let api_sig = md5_hex(&sig_input);
    pairs.push(("format".into(), "json".into()));
    pairs.push(("api_sig".into(), api_sig));

    let client = reqwest::Client::new();
    let res = client
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
