//! Local media proxy shared by desktop and Android. No control API routes.
use axum::{
    body::Body,
    extract::Query,
    http::{header::HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::TryStreamExt;
use std::collections::HashMap;

pub fn router() -> Router {
    Router::new().route(
        "/audio",
        get(audio_proxy).options(|| async {
            let mut res = Response::new(Body::empty());
            *res.status_mut() = StatusCode::NO_CONTENT;
            res.headers_mut().insert(
                axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            res.headers_mut().insert(
                axum::http::header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, HEAD, OPTIONS"),
            );
            res.headers_mut().insert(
                axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("range"),
            );
            res
        }),
    )
}

#[cfg(target_os = "android")]
pub fn start() -> Result<(), String> {
    // Bind before frontend startup so the first stream cannot race the listener.
    let listener = std::net::TcpListener::bind("127.0.0.1:8299").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::Builder::new()
        .name("wave-media".into())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("media runtime");
            runtime.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("media listener");
                if let Err(error) = axum::serve(listener, router()).await {
                    eprintln!("[wave-media] {error}");
                }
            });
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

const MEDIA_HOST_ALLOWLIST: &[&str] = &[
    ".googlevideo.com",
    ".sndcdn.com",
    ".media-streaming.soundcloud.cloud",
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

async fn audio_proxy(
    headers: axum::http::HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(url) = params.get("url") else {
        return (StatusCode::BAD_REQUEST, "missing url").into_response();
    };
    if !media_host_allowed(url) {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    if let Err(e) = super::validate_http_url(url).await {
        return (StatusCode::FORBIDDEN, e).into_response();
    }
    let mut req = super::client().get(url);
    if let Some(range) = headers.get("range").and_then(|v| v.to_str().ok()) {
        req = req.header("range", range);
    }
    let response = match req.send().await {
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
    let content_length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let accept_ranges = response
        .headers()
        .get("accept-ranges")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_range = response
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let stream = response.bytes_stream();
    let body = Body::from_stream(stream.map_err(std::io::Error::other));
    let mut res = Response::new(body);
    *res.status_mut() = status;
    res.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    res.headers_mut().insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    res.headers_mut().insert(
        axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Accept-Ranges"),
    );
    res.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    if let Some(cl) = content_length {
        if let Ok(v) = HeaderValue::from_str(&cl) {
            res.headers_mut()
                .insert(axum::http::header::CONTENT_LENGTH, v);
        }
    }
    if let Some(ar) = accept_ranges {
        if let Ok(v) = HeaderValue::from_str(&ar) {
            res.headers_mut()
                .insert(axum::http::header::ACCEPT_RANGES, v);
        }
    }
    if let Some(cr) = content_range {
        if let Ok(v) = HeaderValue::from_str(&cr) {
            res.headers_mut()
                .insert(axum::http::header::CONTENT_RANGE, v);
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn media_listener_serves_preflight_without_exposing_control_routes() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router()).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://{address}");
        let options = client
            .request(reqwest::Method::OPTIONS, format!("{url}/audio"))
            .send()
            .await
            .unwrap();
        assert_eq!(options.status(), StatusCode::NO_CONTENT);
        assert_eq!(options.headers()["access-control-allow-headers"], "range");
        assert_eq!(
            client
                .get(format!("{url}/audio"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            client
                .get(format!("{url}/audio?url=http://127.0.0.1/private"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .post(format!("{url}/api/v1/play"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            client
                .get(format!("{url}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        server.abort();
    }
}
