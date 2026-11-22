//! SoundCloud discovery, metadata and stream resolution.
static SC_CLIENT_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

async fn sc_extract_client_id() -> Result<String, String> {
    if let Some(id) = SC_CLIENT_ID.get() {
        return Ok(id.clone());
    }
    let page = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        crate::http::send_auto(|http| {
            http.get("https://soundcloud.com").header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
        }),
    )
    .await
    .map_err(|_| "soundcloud page: timeout".to_string())?
    .map_err(|e| format!("soundcloud page: {e}"))?;

    let page = page
        .text()
        .await
        .map_err(|e| format!("soundcloud page read: {e}"))?;

    for script_url in extract_script_urls(&page).into_iter().rev().take(6) {
        let resp = match tokio::time::timeout(
            std::time::Duration::from_secs(6),
            crate::http::send_auto(|http| {
                http.get(&script_url).header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
            }),
        )
        .await
        {
            Ok(Ok(r)) => r,
            _ => continue,
        };
        let js = match resp.text().await {
            Ok(t) => t,
            Err(_) => continue,
        };
        if let Some(id) = extract_client_id_from_js(&js) {
            let _ = SC_CLIENT_ID.set(id.clone());
            return Ok(id);
        }
    }
    Err("soundcloud: could not extract client_id".into())
}

fn extract_client_id_from_js(js: &str) -> Option<String> {
    let bytes = js.as_bytes();
    let mut pos = 0;
    while let Some(rel) = js[pos..].find("client_id") {
        let mut i = pos + rel + "client_id".len();
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b':' || bytes[i] == b'=') {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        let quote = bytes[i];
        if quote != b'"' && quote != b'\'' {
            pos = pos + rel + 1;
            continue;
        }
        i += 1;
        let end_rel = js[i..].find(quote as char)?;
        let candidate = &js[i..i + end_rel];
        if candidate.len() == 32 && candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Some(candidate.to_string());
        }
        pos = pos + rel + 1;
    }
    None
}

fn extract_script_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let marker = r#"src=""#;
    let mut pos = 0;
    while let Some(idx) = html[pos..].find(marker) {
        let start = pos + idx + marker.len();
        if let Some(end) = html[start..].find('"') {
            let url = &html[start..start + end];
            if url.contains("sndcdn.com/assets/") && url.ends_with(".js") {
                urls.push(url.to_string());
            }
            pos = start + end + 1;
        } else {
            break;
        }
    }
    urls
}

async fn sc_stream_url(track_id: &str, client_id: &str) -> Result<String, String> {
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

    let track_api =
        format!("https://api-v2.soundcloud.com/tracks/{track_id}?client_id={client_id}");
    let resp = crate::http::send_auto(|http| http.get(&track_api).header("User-Agent", ua))
        .await
        .map_err(|e| format!("soundcloud track: {e}"))?;
    let status = resp.status();
    let track: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("soundcloud track parse: {e}"))?;
    if !status.is_success() {
        return Err(format!("soundcloud track HTTP {status}"));
    }

    let transcodings = track["media"]["transcodings"]
        .as_array()
        .ok_or_else(|| "soundcloud: no transcodings".to_string())?;
    let progress = transcodings
        .iter()
        .find(|t| t["format"]["protocol"].as_str() == Some("progressive"));
    let trans = progress
        .or_else(|| {
            transcodings
                .iter()
                .find(|t| t["format"]["protocol"].as_str() == Some("hls"))
        })
        .ok_or_else(|| "soundcloud: no playable transcoding".to_string())?;

    let media_api = trans["url"]
        .as_str()
        .ok_or_else(|| "soundcloud: no media url".to_string())?;
    let media_api = format!("{media_api}?client_id={client_id}");
    let resp = crate::http::send_auto(|http| http.get(&media_api).header("User-Agent", ua))
        .await
        .map_err(|e| format!("soundcloud stream: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("soundcloud stream HTTP {status}"));
    }
    let media: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("soundcloud stream parse: {e}"))?;

    media["url"]
        .as_str()
        .map(|u| u.to_string())
        .ok_or_else(|| "soundcloud: no stream url in media response".to_string())
}

#[tauri::command]
pub(crate) async fn sc_resolve_stream(track_url: String) -> Result<String, String> {
    let client_id = sc_extract_client_id().await?;

    let track_id = track_url
        .split('/')
        .next_back()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");

    let track_id = track_id
        .strip_prefix("soundcloud%3Atracks%3A")
        .or_else(|| track_id.strip_prefix("soundcloud:tracks:"))
        .unwrap_or(track_id);

    tokio::time::timeout(
        std::time::Duration::from_secs(12),
        sc_stream_url(track_id, &client_id),
    )
    .await
    .map_err(|_| "soundcloud: timeout".to_string())?
}

/// Проверка прокси: лёгкий 204-запрос к YouTube строго через прокси-клиент.
/// Нужна кнопке «Проверить» в настройках (РФ без VPN и т.п.).
/// url/mode опциональны: если заданы — проверяются именно они (ещё не сохранённые).
#[tauri::command]
pub(crate) async fn sc_search(query: String, limit: u32) -> Result<Vec<serde_json::Value>, String> {
    let client_id = sc_extract_client_id().await?;
    let limit = limit.clamp(1, 50) as usize;

    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.get("https://api-v2.soundcloud.com/search/tracks")
                    .query(&[
                        ("client_id", client_id.as_str()),
                        ("q", query.as_str()),
                        ("limit", &limit.to_string()),
                        ("offset", "0"),
                        ("app_locale", "en"),
                    ])
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "soundcloud search: timeout".to_string())?
        .map_err(|e| format!("soundcloud search: {e}"))?;

    if !status.is_success() {
        return Err(format!("soundcloud search HTTP {}", status));
    }

    let collection = body["collection"]
        .as_array()
        .ok_or("soundcloud search: no collection")?;

    Ok(sc_collection_to_items(collection, limit, false))
}

fn sc_collection_to_items(
    collection: &[serde_json::Value],
    limit: usize,
    user_priority: bool,
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for t in collection
        .iter()
        .filter(|t| user_priority || t["kind"].as_str() == Some("track"))
    {
        if user_priority {
            if t["kind"].as_str() != Some("user") {
                continue;
            }
            let username = t["username"]
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| t["permalink"].as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            if username.is_empty() {
                continue;
            }
            let followers = t["followers_count"].as_i64().unwrap_or(0);
            let avatar = t["avatar_url"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            out.push(serde_json::json!({
                "username": username,
                "followersCount": followers,
                "avatar": avatar,
            }));
            if out.len() >= limit {
                break;
            }
            continue;
        }
        let Some(tid) = t["id"].as_u64() else {
            continue;
        };
        let title = t["title"].as_str().unwrap_or("").to_string();
        let uploader = t["user"]["username"].as_str().unwrap_or("").to_string();
        let duration_ms = t["duration"].as_u64().unwrap_or(0);
        let thumbnail = t["artwork_url"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| t["user"]["avatar_url"].as_str().filter(|s| !s.is_empty()))
            .map(|s| s.to_string());
        let permalink = t["permalink_url"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        out.push(serde_json::json!({
            "id": tid.to_string(),
            "title": title,
            "uploader": uploader,
            "duration": if duration_ms > 0 { Some(duration_ms / 1000) } else { None },
            "thumbnail": thumbnail,
            "genre": t["genre"].as_str().filter(|value| !value.is_empty()),
            "tagList": t["tag_list"].as_str().filter(|value| !value.is_empty()),
            "creditedArtist": t["publisher_metadata"]["artist"].as_str().filter(|value| !value.is_empty()),
            "downloadable": t["downloadable"].as_bool() == Some(true) && t["has_downloads_left"].as_bool() != Some(false),
            "permalinkUrl": permalink,
        }));
        if out.len() >= limit {
            break;
        }
    }
    out
}

#[tauri::command]
pub(crate) async fn sc_search_users(
    query: String,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let client_id = sc_extract_client_id().await?;
    let limit = limit.clamp(1, 20) as usize;

    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.get("https://api-v2.soundcloud.com/search/users")
                    .query(&[
                        ("client_id", client_id.as_str()),
                        ("q", query.as_str()),
                        ("limit", &limit.to_string()),
                        ("offset", "0"),
                        ("app_locale", "en"),
                    ])
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "soundcloud users: timeout".to_string())?
        .map_err(|e| format!("soundcloud users: {e}"))?;

    if !status.is_success() {
        return Err(format!("soundcloud users HTTP {}", status));
    }

    let collection = body["collection"]
        .as_array()
        .ok_or("soundcloud users: no collection")?;

    Ok(sc_collection_to_items(collection, limit, true))
}

#[tauri::command]
pub(crate) async fn sc_related_tracks(
    track_id: String,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let client_id = sc_extract_client_id().await?;
    let limit = limit.clamp(1, 50) as usize;
    // Тянем с запасом: длинные "миксы" (>20 мин) отфильтруем внизу.
    let fetch = (limit * 2 + 3).min(100).max(limit);

    let raw = track_id
        .split('/')
        .next_back()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let track_id = raw
        .strip_prefix("soundcloud%3Atracks%3A")
        .or_else(|| raw.strip_prefix("soundcloud:tracks:"))
        .unwrap_or(raw);

    let api_url = format!("https://api-v2.soundcloud.com/tracks/{}/related", track_id);

    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.get(&api_url)
                    .query(&[
                        ("client_id", client_id.as_str()),
                        ("limit", &fetch.to_string()),
                    ])
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "soundcloud related: timeout".to_string())?
        .map_err(|e| format!("soundcloud related: {e}"))?;

    if !status.is_success() {
        return Err(format!("soundcloud related HTTP {}", status));
    }

    let collection = body["collection"]
        .as_array()
        .ok_or("soundcloud related: no collection")?;

    let mut items = sc_collection_to_items(collection, fetch, false);
    // Отбрасываем длинные миксы/потоки (>20 мин): для радио-плейлиста бесполезны.
    items.retain(|t| {
        let dur = t["duration"].as_i64().unwrap_or(0);
        dur > 0 && dur <= 20 * 60
    });
    items.truncate(limit);
    Ok(items)
}

/// Резолв ссылки soundcloud.com/... в объект трека или плейлиста (api-v2 /resolve).
/// Нужно для импорта плейлистов по ссылке — работает и на Android.
#[tauri::command]
pub(crate) async fn sc_resolve_url(page_url: String) -> Result<serde_json::Value, String> {
    let client_id = sc_extract_client_id().await?;
    let (status, body): (reqwest::StatusCode, serde_json::Value) =
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let resp = crate::http::send_auto(|http| {
                http.get("https://api-v2.soundcloud.com/resolve")
                    .query(&[
                        ("client_id", client_id.as_str()),
                        ("url", page_url.as_str()),
                    ])
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
            })
            .await?;
            let status = resp.status();
            let body = resp.json().await?;
            Ok::<_, reqwest::Error>((status, body))
        })
        .await
        .map_err(|_| "soundcloud resolve: timeout".to_string())?
        .map_err(|e| format!("soundcloud resolve: {e}"))?;

    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("soundcloud resolve: not found (private/deleted?)".to_string());
    }
    if !status.is_success() {
        return Err(format!("soundcloud resolve HTTP {}", status));
    }
    Ok(body)
}

#[tauri::command]
pub(crate) async fn sc_import_likes(profile: String) -> Result<serde_json::Value, String> {
    if profile.is_empty()
        || profile.len() > 100
        || !profile.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("SoundCloud: invalid profile name".into());
    }
    let user = sc_resolve_url(format!("https://soundcloud.com/{profile}")).await?;
    let id = user["id"]
        .as_u64()
        .filter(|_| user["kind"].as_str() == Some("user"))
        .ok_or("SoundCloud: no public profile at this URL")?;
    let name = user["username"].as_str().unwrap_or(&profile);
    let client_id = sc_extract_client_id().await?;
    let path = format!("/users/{id}/likes");
    let root = format!("https://api-v2.soundcloud.com{path}");
    let mut url = reqwest::Url::parse(&root).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("limit", "100")
        .append_pair("linked_partitioning", "true")
        .append_pair("client_id", &client_id);
    let mut seen = std::collections::HashSet::new();
    let mut visited = std::collections::HashSet::new();
    let mut tracks = Vec::new();
    const MAX_TRACKS: usize = 1000;
    for _ in 0..30 {
        if !visited.insert(url.as_str().to_owned()) {
            return Err("SoundCloud: likes pagination repeated".into());
        }
        let response = tokio::time::timeout(std::time::Duration::from_secs(8), async {
            let resp = crate::http::send_auto(|http| http.get(url.clone())).await?;
            resp.error_for_status()?.json::<serde_json::Value>().await
        })
        .await
        .map_err(|_| "SoundCloud: likes request timed out".to_owned())?
        .map_err(|e| {
            e.status().map_or_else(
                || "SoundCloud: could not read likes".to_owned(),
                |status| format!("SoundCloud likes HTTP {status}"),
            )
        })?;
        let entries = response["collection"]
            .as_array()
            .ok_or("SoundCloud: invalid likes response")?;
        let page: Vec<_> = entries
            .iter()
            .filter_map(|entry| entry.get("track"))
            .filter(|track| track["policy"].as_str() != Some("BLOCK") && track["sharing"].as_str() != Some("private"))
            .filter(|track| track["id"].as_u64().is_some_and(|id| seen.insert(id)))
            .filter(|track| track["title"].as_str().is_some_and(|title| !title.trim().is_empty()))
            .cloned()
            .collect();
        tracks.extend(sc_collection_to_items(&page, MAX_TRACKS - tracks.len(), false));
        if tracks.len() >= MAX_TRACKS {
            break;
        }
        let Some(next) = response["next_href"].as_str().filter(|value| !value.is_empty()) else {
            break;
        };
        let mut next = reqwest::Url::parse(next).map_err(|_| "SoundCloud: invalid likes cursor")?;
        if next.scheme() != "https" || next.host_str() != Some("api-v2.soundcloud.com")
            || next.path() != path || next.port().is_some() || !next.username().is_empty() || next.password().is_some()
        {
            return Err("SoundCloud: unexpected likes cursor".into());
        }
        let query: Vec<_> = next.query_pairs().into_owned().filter(|(key, _)| key != "client_id").collect();
        next.query_pairs_mut()
            .clear()
            .extend_pairs(query)
            .append_pair("client_id", &client_id);
        url = next;
    }
    Ok(serde_json::json!({ "name": format!("{name} · SoundCloud Likes"), "tracks": tracks }))
}
