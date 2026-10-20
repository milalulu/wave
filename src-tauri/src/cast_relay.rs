//! Session-scoped media relay. The control API remains bound to loopback.
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    sync::RwLock,
};

#[derive(Clone)]
enum Source {
    Remote(reqwest::Url),
    File(std::path::PathBuf),
}
#[derive(Clone)]
struct Entry {
    token: String,
    source: Source,
}
#[derive(Clone)]
struct RelayState {
    active: Arc<AtomicBool>,
    peer: IpAddr,
    entry: Arc<RwLock<Option<Entry>>>,
    client: reqwest::Client,
}
pub struct Relay {
    state: RelayState,
    address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Relay {
    fn drop(&mut self) {
        self.state.active.store(false, Ordering::Release);
        self.task.abort();
    }
}
impl Relay {
    pub async fn start(peer: SocketAddr) -> Result<Self, String> {
        let route = tokio::net::UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| e.to_string())?;
        route.connect(peer).await.map_err(|e| e.to_string())?;
        let local = route.local_addr().map_err(|e| e.to_string())?.ip();
        let listener = tokio::net::TcpListener::bind(SocketAddr::new(local, 0))
            .await
            .map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let state = RelayState {
            active: Arc::new(AtomicBool::new(true)),
            peer: peer.ip(),
            entry: Arc::default(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(8))
                .read_timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|e| e.to_string())?,
        };
        let app = Router::new()
            .route("/{token}", get(serve).options(serve))
            .with_state(state.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });
        Ok(Self {
            state,
            address,
            task,
        })
    }
    pub async fn register(&self, src: &str) -> Result<(String, String), String> {
        let source = source(src).await?;
        let mut mime = match &source {
            Source::Remote(url) => url
                .query_pairs()
                .find(|(k, _)| k == "mime")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_else(|| content_type(url.path()).into()),
            Source::File(path) => content_type(&path.to_string_lossy()).into(),
        };
        if let Source::Remote(url) = &source {
            if let Ok(Ok(response)) = tokio::time::timeout(
                std::time::Duration::from_secs(4),
                self.state.client.head(url.clone()).send(),
            )
            .await
            {
                if let Some(kind) = response
                    .headers()
                    .get("content-type")
                    .and_then(|h| h.to_str().ok())
                {
                    let kind = kind.split(';').next().unwrap_or("").trim();
                    if kind.starts_with("audio/") || kind == "video/mp4" || kind == "video/webm" {
                        mime = kind.into();
                    }
                    if kind.to_ascii_lowercase().contains("mpegurl") || kind.contains("dash+xml") {
                        return Err("Cast requires a direct audio stream, not a manifest".into());
                    }
                }
            }
        }
        let mut bytes = [0u8; 24];
        getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        *self.state.entry.write().await = Some(Entry {
            token: token.clone(),
            source,
        });
        Ok((format!("http://{}/{token}", self.address), mime))
    }
}
fn content_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "m4a" | "mp4" => "audio/mp4",
        "webm" => "audio/webm",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        _ => "audio/mpeg",
    }
}
async fn source(src: &str) -> Result<Source, String> {
    let mut url = reqwest::Url::parse(src).map_err(|e| e.to_string())?;
    if url.host_str() == Some("127.0.0.1") && url.port() == Some(8299) && url.path() == "/audio" {
        let inner = url
            .query_pairs()
            .find(|(k, _)| k == "url")
            .ok_or("Missing audio URL")?
            .1
            .into_owned();
        url = reqwest::Url::parse(&inner).map_err(|e| e.to_string())?;
    }
    if url.scheme() == "asset"
        || url.host_str() == Some("asset.localhost")
        || url.scheme() == "file"
    {
        let decoded = percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .map_err(|e| e.to_string())?
            .into_owned();
        #[cfg(windows)]
        let decoded = decoded.trim_start_matches('/').to_string();
        let path = std::path::PathBuf::from(decoded);
        if !path.is_absolute()
            || !tokio::fs::metadata(&path)
                .await
                .map_err(|e| e.to_string())?
                .is_file()
        {
            return Err("Not an audio file".into());
        }
        return Ok(Source::File(path));
    }
    let url = crate::http::validate_http_url(url.as_str()).await?;
    if url.path().ends_with(".m3u8") || url.path().ends_with(".mpd") {
        return Err("Cast requires a direct audio stream, not a manifest".into());
    }
    Ok(Source::Remote(url))
}
fn byte_range(value: Option<&str>, len: u64) -> Result<(u64, u64, bool), ()> {
    if len == 0 {
        return Err(());
    }
    let Some(value) = value else {
        return Ok((0, len - 1, false));
    };
    let (a, b) = value
        .strip_prefix("bytes=")
        .ok_or(())?
        .split_once('-')
        .ok_or(())?;
    let (start, end) = if a.is_empty() {
        let suffix = b.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        (len.saturating_sub(suffix), len - 1)
    } else {
        (
            a.parse().map_err(|_| ())?,
            if b.is_empty() {
                len - 1
            } else {
                b.parse::<u64>().map_err(|_| ())?.min(len - 1)
            },
        )
    };
    if start > end || start >= len {
        return Err(());
    }
    Ok((start, end, true))
}
async fn serve(
    State(state): State<RelayState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if !state.active.load(Ordering::Acquire) || peer.ip() != state.peer {
        return StatusCode::FORBIDDEN.into_response();
    }
    let entry = state.entry.read().await.clone();
    let Some(entry) = entry.filter(|e| e.token == token) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = if method == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        match serve_source(&state.client, entry.source, headers).await {
            Ok(r) => r,
            Err(_) => StatusCode::BAD_GATEWAY.into_response(),
        }
    };
    if !state.active.load(Ordering::Acquire) {
        return StatusCode::FORBIDDEN.into_response();
    }
    for (key, value) in [
        ("connection", "close"),
        ("access-control-allow-origin", "*"),
        ("access-control-allow-methods", "GET, HEAD, OPTIONS"),
        ("access-control-allow-headers", "Range"),
        (
            "access-control-expose-headers",
            "Content-Length, Content-Range, Accept-Ranges",
        ),
    ] {
        response
            .headers_mut()
            .insert(key, HeaderValue::from_static(value));
    }
    response
}
async fn serve_source(
    client: &reqwest::Client,
    source: Source,
    headers: HeaderMap,
) -> Result<Response, String> {
    let range = headers.get("range").and_then(|h| h.to_str().ok());
    match source {
        Source::Remote(url) => {
            let mut request = client.get(url).header("user-agent", "Mozilla/5.0");
            if let Some(range) = range {
                request = request.header("range", range);
            }
            let upstream = request.send().await.map_err(|e| e.to_string())?;
            let mut response = Response::builder().status(upstream.status());
            for key in [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
            ] {
                if let Some(v) = upstream.headers().get(key) {
                    response = response.header(key, v);
                }
            }
            response
                .body(Body::from_stream(upstream.bytes_stream()))
                .map_err(|e| e.to_string())
        }
        Source::File(path) => {
            let mut file = tokio::fs::File::open(&path)
                .await
                .map_err(|e| e.to_string())?;
            let len = file.metadata().await.map_err(|e| e.to_string())?.len();
            let Ok((start, end, partial)) = byte_range(range, len) else {
                return Ok((
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    [("content-range", format!("bytes */{len}"))],
                )
                    .into_response());
            };
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|e| e.to_string())?;
            let stream = futures_util::stream::try_unfold(
                (file, end - start + 1),
                |(mut file, remaining)| async move {
                    if remaining == 0 {
                        return Ok::<_, std::io::Error>(None);
                    }
                    let mut bytes = vec![0; remaining.min(64 * 1024) as usize];
                    let read = file.read(&mut bytes).await?;
                    if read == 0 {
                        return Err(std::io::ErrorKind::UnexpectedEof.into());
                    }
                    bytes.truncate(read);
                    Ok(Some((bytes, (file, remaining - read as u64))))
                },
            );
            let mut response = Response::builder()
                .status(if partial { 206 } else { 200 })
                .header("accept-ranges", "bytes")
                .header("content-type", content_type(&path.to_string_lossy()))
                .header("content-length", end - start + 1);
            if partial {
                response = response.header("content-range", format!("bytes {start}-{end}/{len}"));
            }
            response
                .body(Body::from_stream(stream))
                .map_err(|e| e.to_string())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_cover_seek_suffix_and_invalid_requests() {
        assert_eq!(byte_range(None, 100), Ok((0, 99, false)));
        assert_eq!(byte_range(Some("bytes=10-20"), 100), Ok((10, 20, true)));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Ok((90, 99, true)));
        assert_eq!(byte_range(Some("bytes=90-"), 100), Ok((90, 99, true)));
        for value in ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=0-1,3-4"] {
            assert!(byte_range(Some(value), 100).is_err());
        }
    }
    #[tokio::test]
    async fn relay_requires_current_token_and_serves_exact_range() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("music.mp3");
        tokio::fs::write(&path, b"0123456789").await.unwrap();
        let relay = Relay::start("127.0.0.1:8009".parse().unwrap())
            .await
            .unwrap();
        let src = reqwest::Url::from_file_path(path).unwrap();
        let (url, _) = relay.register(src.as_str()).await.unwrap();
        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("Range", "bytes=2-5")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"2345");
        let (current_url, _) = relay.register(src.as_str()).await.unwrap();
        assert_eq!(client.get(url).send().await.unwrap().status(), 404);
        relay.state.active.store(false, Ordering::Release);
        assert_eq!(client.get(current_url).send().await.unwrap().status(), 403);
    }
}
