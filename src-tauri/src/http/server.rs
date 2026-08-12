use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::bridge::BridgeHandle;

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

pub fn router(app: AppHandle, bridge: BridgeHandle, token: String) -> Router {
    let state = ServerState { app, bridge, token };
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
        .route_layer(middleware::from_fn_with_state(state.clone(), auth));
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/health", get(health))
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
        .map(|v| v == token)
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
