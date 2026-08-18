use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{header::HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::AppHandle;

use super::bridge::BridgeHandle;

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.as_bytes().iter().zip(b.as_bytes().iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[derive(Clone)]
pub struct ServerState {
    pub app: AppHandle,
    pub bridge: BridgeHandle,
    pub token: String,
}

const BIND: &str = "127.0.0.1:8299";

macro_rules! route_handler {
    ($name:ident, $action:expr) => {
        async fn $name(State(state): State<ServerState>, body: Option<Json<Value>>) -> Response {
            bridge_call(&state, $action, body.map(|j| j.0).unwrap_or(Value::Null)).await
        }
    };
}

route_handler!(status, "player.status");
route_handler!(play, "player.play");
route_handler!(pause, "player.pause");
route_handler!(resume, "player.resume");
route_handler!(next, "player.next");
route_handler!(previous, "player.previous");
route_handler!(seek, "player.seek");
route_handler!(volume, "player.volume");
route_handler!(shuffle, "player.shuffle");
route_handler!(repeat, "player.repeat");
route_handler!(queue_list, "queue.list");
route_handler!(queue_add, "queue.add");
route_handler!(queue_clear, "queue.clear");
route_handler!(search, "search.query");
route_handler!(play_search, "search.play");
route_handler!(like, "library.like");
route_handler!(history, "history.list");
route_handler!(wave_start, "wave.start");
route_handler!(variants, "variants.list");
route_handler!(sources_list, "sources.list");
route_handler!(sources_set, "sources.set");
route_handler!(radio, "player.radio");
route_handler!(similar, "player.similar");
route_handler!(lyrics, "lyrics.list");
route_handler!(download, "download.track");
route_handler!(blocks_tracks, "blocks.tracks");
route_handler!(block_track_toggle, "blocks.track.toggle");
route_handler!(blocks_artists, "blocks.artists");
route_handler!(block_artist_toggle, "blocks.artist.toggle");

pub fn router(app: AppHandle, bridge: BridgeHandle, token: String) -> Router {
    let state = ServerState { app, bridge, token };
    let media = Router::new().route("/audio", get(audio_proxy));
    let health = Router::new()
        .route("/health", get(health))
        .route("/api/v1/health", get(health))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth));
    let v1 = Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/play", post(play))
        .route("/api/v1/pause", post(pause))
        .route("/api/v1/resume", post(resume))
        .route("/api/v1/next", post(next))
        .route("/api/v1/previous", post(previous))
        .route("/api/v1/seek", post(seek))
        .route("/api/v1/volume", post(volume))
        .route("/api/v1/shuffle", post(shuffle))
        .route("/api/v1/repeat", post(repeat))
        .route("/api/v1/queue", get(queue_list))
        .route("/api/v1/queue/add", post(queue_add))
        .route("/api/v1/queue/clear", post(queue_clear))
        .route("/api/v1/search", post(search))
        .route("/api/v1/play_search", post(play_search))
        .route("/api/v1/like", post(like))
        .route("/api/v1/history", get(history))
        .route("/api/v1/wave/start", post(wave_start))
        .route("/api/v1/variants", get(variants))
        .route("/api/v1/sources", get(sources_list))
        .route("/api/v1/sources", post(sources_set))
        .route("/api/v1/radio", post(radio))
        .route("/api/v1/similar", post(similar))
        .route("/api/v1/lyrics", get(lyrics))
        .route("/api/v1/download", post(download))
        .route("/api/v1/blocks/tracks", get(blocks_tracks))
        .route("/api/v1/blocks/track", post(block_track_toggle))
        .route("/api/v1/blocks/artists", get(blocks_artists))
        .route("/api/v1/blocks/artist", post(block_artist_toggle))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth));
    Router::new()
        .merge(media)
        .merge(health)
        .merge(v1)
        .with_state(state)
}

pub fn start(app: AppHandle, bridge: BridgeHandle, token: String) {
    std::thread::Builder::new()
        .name("wave-http".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            rt.block_on(async move {
                let listener = match tokio::net::TcpListener::bind(BIND).await {
                    Ok(listener) => listener,
                    Err(e) => {
                        eprintln!("[wave-http] failed to bind {BIND}: {e}");
                        return;
                    }
                };
                eprintln!("[wave-http] listening on http://{BIND}");
                let router = router(app, bridge, token);
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[wave-http] server error: {e}");
                }
            });
        })
        .expect("failed to spawn wave-http thread");
}

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "service": "wave" }))
}

async fn auth(State(state): State<ServerState>, request: Request, next: Next) -> Response {
    let token = &state.token;
    if token.is_empty() {
        return next.run(request).await;
    }
    let authorized = request
        .headers()
        .get("X-Api-Token")
        .and_then(|v| v.to_str().ok())
        .map(|v| constant_time_eq(v, token))
        .unwrap_or(false);
    if authorized {
        next.run(request).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "unauthorized" })),
        )
            .into_response()
    }
}

async fn bridge_call(state: &ServerState, action: &str, payload: Value) -> Response {
    match state.bridge.request(&state.app, action, payload).await {
        Ok(value) => Json(value).into_response(),
        Err(e) => {
            let code = if e.contains("timeout") {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::BAD_REQUEST
            };
            (code, Json(json!({ "error": e }))).into_response()
        }
    }
}

const MEDIA_HOST_ALLOWLIST: [&str; 10] = [
    ".googlevideo.com",
    ".sndcdn.com",
    ".media-streaming.soundcloud.cloud",
    ".itunes.apple.com",
    ".dzcdn.net",
    ".userapi.com",
    ".vk.me",
    ".vk.com",
    ".last.fm",
    ".freetls.fastly.net",
];

fn media_host_allowed(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    MEDIA_HOST_ALLOWLIST
        .iter()
        .any(|suffix| host == suffix.trim_start_matches('.') || host.ends_with(suffix))
}

async fn audio_proxy(Query(params): Query<HashMap<String, String>>) -> Response {
    let Some(url) = params.get("url") else {
        return (StatusCode::BAD_REQUEST, "missing url").into_response();
    };
    if !media_host_allowed(url) {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    if let Err(e) = super::validate_http_url(url).await {
        return (StatusCode::FORBIDDEN, e).into_response();
    }
    let response = match super::client().get(url).send().await {
        Ok(res) => res,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("proxy fetch: {e}")).into_response();
        }
    };
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    match response.bytes().await {
        Ok(body) => {
            let mut res = Response::new(Body::from(body));
            *res.status_mut() = status;
            res.headers_mut()
                .insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
            res.headers_mut().insert(
                "Content-Type",
                HeaderValue::from_str(&content_type)
                    .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
            );
            res
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("proxy body: {e}")).into_response(),
    }
}
